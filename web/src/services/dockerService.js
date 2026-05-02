'use strict';

const http = require('http');
const os = require('os');

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const ALLOWED_SERVICES = new Set(['mma', 'replicator']);
// Seconds Docker waits for a graceful SIGTERM before sending SIGKILL on safe stop/restart.
const MMA_SAFE_STOP_TIMEOUT_SECS = 30;
const DOCKER_LOG_TAIL_LINES = 100;

let APP_VERSION = process.env.APP_VERSION || 'dev';
let DOCKER_DIGEST = process.env.DOCKER_DIGEST || null;

function getAppVersion() { return APP_VERSION; }
function getDockerDigest() { return DOCKER_DIGEST; }

/**
 * Make an HTTP request to the Docker daemon socket.
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} apiPath - Docker API path (e.g. '/containers/mma/json')
 * @returns {Promise<{status: number, body: any}>}
 */
function dockerApi(method, apiPath) {
    return new Promise((resolve, reject) => {
        const opts = {
            socketPath: DOCKER_SOCKET,
            method,
            path: apiPath,
            headers: { 'Content-Type': 'application/json' },
        };
        const req = http.request(opts, (dockerRes) => {
            let data = '';
            dockerRes.on('data', chunk => { data += chunk; });
            dockerRes.on('end', () => {
                let body = null;
                if (data) {
                    try { body = JSON.parse(data); } catch (parseErr) {
                        console.warn(`[dockerApi] Failed to parse Docker response for ${method} ${apiPath}: ${parseErr.message}`);
                        body = data;
                    }
                }
                resolve({ status: dockerRes.statusCode, body });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

/**
 * Restart MMA and Replicator containers sequentially via the Docker socket.
 * MMA is given a graceful SIGTERM window (MMA_SAFE_STOP_TIMEOUT_SECS); Replicator
 * is restarted immediately.
 *
 * @param {string[]} services  - ordered list of service names to restart
 * @returns {Promise<{errors: string[]}>}
 */
async function restartServices(services) {
    const errors = [];
    for (const service of services) {
        try {
            const stopTimeout = service === 'mma' ? `?t=${MMA_SAFE_STOP_TIMEOUT_SECS}` : '';
            const r = await dockerApi('POST', `/containers/${service}/restart${stopTimeout}`);
            if (r.status !== 204 && r.status !== 304) {
                const msg = (r.body && r.body.message) ? r.body.message : `HTTP ${r.status}`;
                errors.push(`${service}: ${msg}`);
            }
        } catch (dockerErr) {
            errors.push(`${service}: ${dockerErr.message}`);
        }
    }
    return { errors };
}

/**
 * Stream Docker container logs via Server-Sent Events.
 * Parses Docker multiplexed frame format (8-byte header: stream byte + 3 padding + 4-byte big-endian size).
 *
 * @param {string} service - Container name (must be in ALLOWED_SERVICES)
 * @param {object} res - Express response object (SSE already configured by caller)
 * @param {object} req - Express request object (used to listen for client disconnect)
 */
function streamContainerLogs(service, res, req) {
    const apiPath = `/containers/${encodeURIComponent(service)}/logs?follow=1&stdout=1&stderr=1&timestamps=1&tail=${DOCKER_LOG_TAIL_LINES}`;

    const opts = {
        socketPath: DOCKER_SOCKET,
        method: 'GET',
        path: apiPath,
    };

    let dockerReq = null;
    let buffer = Buffer.alloc(0);
    let closed = false;

    const sendEvent = (eventName, data) => {
        if (!closed) {
            try {
                res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
            } catch (_) {
                closed = true;
            }
        }
    };

    const cleanup = () => {
        closed = true;
        if (dockerReq) {
            try { dockerReq.destroy(); } catch (_) {}
            dockerReq = null;
        }
    };

    req.on('close', cleanup);

    try {
        dockerReq = http.request(opts, (dockerRes) => {
            if (dockerRes.statusCode !== 200) {
                sendEvent('log-error', { message: `Docker returned HTTP ${dockerRes.statusCode} for ${service}` });
                res.end();
                return;
            }

            dockerRes.on('data', (chunk) => {
                if (closed) return;
                buffer = Buffer.concat([buffer, chunk]);
                // Parse Docker multiplexed log stream frames.
                // Each frame has an 8-byte header: [stream(1), 0, 0, 0, size_big_endian(4)]
                // stream: 1 = stdout, 2 = stderr
                while (buffer.length >= 8) {
                    const streamType = buffer[0]; // 1=stdout, 2=stderr
                    const frameSize = buffer.readUInt32BE(4);
                    if (buffer.length < 8 + frameSize) break;
                    const payload = buffer.slice(8, 8 + frameSize).toString('utf8');
                    buffer = buffer.slice(8 + frameSize);
                    const lines = payload.split('\n');
                    for (const line of lines) {
                        if (line) {
                            sendEvent('log', { type: streamType, line });
                        }
                    }
                }
            });

            dockerRes.on('end', () => {
                sendEvent('stream-end', {});
                res.end();
            });

            dockerRes.on('error', (err) => {
                sendEvent('log-error', { message: err.message });
                res.end();
            });
        });

        dockerReq.on('error', (err) => {
            if (!res.headersSent) {
                res.status(500).json({ error: err.message });
            } else {
                sendEvent('log-error', { message: err.message });
                res.end();
            }
        });

        dockerReq.end();
    } catch (err) {
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        } else {
            sendEvent('log-error', { message: err.message });
            res.end();
        }
    }
}

/**
 * Discover the running image tag via the Docker socket and update APP_VERSION.
 * Falls back to the current value (env var or 'dev') if discovery fails.
 */
async function discoverVersion() {
    try {
        const id = os.hostname();
        const result = await dockerApi('GET', `/containers/${id}/json`);
        if (result.status === 200 && result.body?.Config?.Image) {
            const image = result.body.Config.Image; // e.g. "rodtamin/mcs-web:v1.2.3"
            const tag = image.includes(':') ? image.split(':').pop() : null;
            if (tag) {
                APP_VERSION = tag;
                console.log(`[version] Discovered version from image tag: ${APP_VERSION}`);
            }
            // Discover digest from image metadata if not already set via env var
            if (!DOCKER_DIGEST) {
                try {
                    const imgResult = await dockerApi('GET', `/images/${encodeURIComponent(image)}/json`);
                    if (imgResult.status === 200 && Array.isArray(imgResult.body?.RepoDigests) && imgResult.body.RepoDigests.length > 0) {
                        // RepoDigests entries are like "repo@sha256:hexhash"
                        const repoDigest = imgResult.body.RepoDigests[0];
                        const atIdx = repoDigest.indexOf('@');
                        const digestPart = atIdx !== -1 ? repoDigest.slice(atIdx + 1) : repoDigest;
                        // 'sha256:' (7) + at least 6 hex chars = 13 minimum meaningful digest
                        if (digestPart.startsWith('sha256:') && digestPart.length > 13) {
                            DOCKER_DIGEST = digestPart;
                            console.log(`[version] Discovered digest: ${DOCKER_DIGEST.slice(0, 19)}…`);
                        }
                    }
                } catch (imgErr) {
                    console.warn(`[version] Could not fetch image digest: ${imgErr.message}`);
                }
            }
        }
    } catch (err) {
        console.warn(`[version] Could not self-discover version via Docker socket: ${err.message}`);
    }
}

module.exports = {
    DOCKER_SOCKET,
    ALLOWED_SERVICES,
    DOCKER_LOG_TAIL_LINES,
    getAppVersion,
    getDockerDigest,
    dockerApi,
    restartServices,
    streamContainerLogs,
    discoverVersion,
};

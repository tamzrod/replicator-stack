'use strict';

const fs = require('fs');
const path = require('path');
const { scryptSync, randomBytes, timingSafeEqual } = require('crypto');

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const AUTH_PATH = path.join(DATA_DIR, 'auth.json');

const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'admin';
// N=16384 (2^14): OWASP-recommended minimum for interactive logins with r=8, p=1.
// Memory cost = 128 * N * r = 16 MB — stays safely under Node.js's 32 MB default maxmem.
// Do not increase N above 32768 without also raising maxmem, as it will exceed the limit.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const HASH_LEN = 64;
const SALT_BYTES = 16;

const _sessions = new Map(); // token → { username, createdAt }
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashPassword(password, salt) {
    return scryptSync(password, salt, HASH_LEN, SCRYPT_PARAMS).toString('hex');
}

function verifyPassword(candidate, auth) {
    const supplied = Buffer.from(hashPassword(candidate, auth.salt), 'hex');
    const stored   = Buffer.from(auth.hash, 'hex');
    return supplied.length === stored.length && timingSafeEqual(supplied, stored);
}

function readAuth() {
    if (fs.existsSync(AUTH_PATH)) {
        try {
            const raw = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf-8'));
            if (raw.username && raw.salt && raw.hash) return raw;
        } catch (_) { /* fall through to default */ }
    }
    const salt = randomBytes(SALT_BYTES).toString('hex');
    const auth = {
        username: DEFAULT_USERNAME,
        salt,
        hash: hashPassword(DEFAULT_PASSWORD, salt),
        mustChangePassword: true,
    };
    writeAuth(auth);
    return auth;
}

function writeAuth(auth) {
    fs.mkdirSync(path.dirname(AUTH_PATH), { recursive: true });
    fs.writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2), 'utf-8');
}

function parseCookies(req) {
    const cookies = {};
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
        const eqIdx = part.indexOf('=');
        if (eqIdx <= 0) continue;
        const k = part.slice(0, eqIdx).trim();
        const v = part.slice(eqIdx + 1).trim();
        if (k) cookies[k] = decodeURIComponent(v);
    }
    return cookies;
}

function requireAuth(req, res, next) {
    // Auth and version routes are always public
    if (req.path.startsWith('/auth/') || req.path === '/version') return next();
    const token = parseCookies(req)['mcs_session'];
    if (!token || !_sessions.has(token)) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    const session = _sessions.get(token);
    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
        _sessions.delete(token);
        return res.status(401).json({ error: 'Session expired' });
    }
    req.authSession = session;
    next();
}

module.exports = {
    _sessions,
    SESSION_TTL_MS,
    SALT_BYTES,
    hashPassword,
    verifyPassword,
    readAuth,
    writeAuth,
    parseCookies,
    requireAuth,
};

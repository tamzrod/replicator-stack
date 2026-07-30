# Evidence: Security Features

**Template Version**: 1.0.0

---

## Metadata

| Field | Value |
|-------|-------|
| ID | EVIDENCE-003 |
| Category | evidence |
| Source | LAB-001 |
| Created | 2026-07-30 |
| Integrity Hash | (pending) |

---

## Evidence Content

### Statement

The system implements OWASP-compliant password hashing using scrypt and enforces integrity checks before configuration deployment.

### Citations

**Source**: web/src/services/authService.js
```javascript
// N=16384 (2^14): OWASP-recommended minimum for interactive logins with r=8, p=1.
// Memory cost = 128 * N * r = 16 MB — stays safely under Node.js's 32 MB default maxmem.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
```

**Source**: web/src/index.js
```javascript
// APPLY gate: only permitted when CHECK passes.
if (applyIntegrityGate(model, res)) return;
```

---

## Evidence Markup

```
[EVIDENCE: web/src/services/authService.js - SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 }]
[EVIDENCE: web/src/index.js - "APPLY gate: only permitted when CHECK passes"]
```

# Experiment Template

**Template Version**: 2.0.0

---

## ⚠️ KDE SIGNATURE REQUIRED

**ALL experiments must be signed by KDE Runtime.**

```python
from runtime.auth import KDEExperimentSigner

signer = KDEExperimentSigner()
signature = signer.sign_experiment(
    experiment_id='LAB-XXX',
    hypothesis='...',
    design={...},
    author='AI Agent'
)

# Write signature file
signer._signer.write_signature_file(signature, 'laboratory/experiments/LAB-XXX')
```

**Without KDE-SIGNATURE, experiment will be REJECTED.**

---

## Metadata

| Field | Value |
|-------|-------|
| ID | LAB-XXX |
| Title | Experiment Title |
| Status | DRAFT |
| Created | YYYY-MM-DD |
| Engine | Engine name |
| Author | Author name |
| Signature Required | ✅ YES |

---

## Purpose

Brief description of what this experiment validates.

---

## Design

### Hypothesis

The hypothesis being tested.

### Methodology

How the experiment will be conducted.

### Expected Results

What results are expected.

### Human Expectations

What the human operator expects to observe.

---

## Execution Log

### Setup

Notes on experiment setup.

### Run 1

**Date**: YYYY-MM-DD

**Observations**:
- Observation 1
- Observation 2

### Run 2

**Date**: YYYY-MM-DD

**Observations**:
- Observation 1
- Observation 2

---

## Results

### Raw Data

Results data here.

### Analysis

Analysis of results.

---

## Verification

### vs Human Expectations

Do results match human expectations?

### Statistical Significance

Are results statistically significant?

---

## Evidence

```
[EVIDENCE: source citation]
[EVIDENCE: source citation]
```

---

## Conclusions

What conclusions can be drawn from this experiment?

---

## Status

- [ ] Design complete
- [ ] Execution complete
- [ ] Analysis complete
- [ ] Evidence documented
- [ ] Ready for validation

---

## Related Artifacts

- Investigation: INV-XXX
- Evidence: (evidence files)
- Signature: KDE-SIGNATURE.yaml

---

## KDE Signature

```
KDE-SIGNATURE:
  signature_id: KDE-SIG-XXXXXXXX
  artifact_id: LAB-XXX
  artifact_type: experiment
  artifact_hash: xxxx...
  issuer: KDE-RUNTIME
  version: 1.0
  signed_at: YYYY-MM-DDTHH:MM:SSZ
  expires_at: YYYY-MM-DDTHH:MM:SSZ
```

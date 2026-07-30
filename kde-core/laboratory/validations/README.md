# Laboratory Validations

**Phase**: Validation

## Purpose

This directory contains **Validations** - verification that experiments produced valid, reproducible results.

## Workflow Position

```
Research ──creates──► Knowledge ──tests──► Laboratory
    ▲                                       │
    │                                       ▼
    │            Governance ──directs──► Evidence
    │              │
    └───────informs
```

## Validation Activities

Validations verify:

1. **Reproducibility** - Can the experiment be repeated?
2. **Statistical Significance** - Are results statistically significant?
3. **Human Expectations** - Do results match human expectations?
4. **Integrity** - Are evidence hashes valid?

## Naming Convention

Validations are numbered with VAL prefix:

```
VAL-001/
VAL-002/
...
VAL-XXX/
```

## Validation Structure

Each validation should contain:

```
VAL-XXX/
├── VALIDATION.md     # Validation report
├── REPRODUCIBILITY.md # Reproducibility check
└── (other files)    # Supporting documents
```

## Validation Status

Artifacts follow this status flow:

```
DRAFT → REVIEW → VALIDATED → APPROVED → PROMOTED
                  ↑               ↑
             (Engine)         (Human)
```

- **DRAFT** - Initial artifact created
- **REVIEW** - Under review
- **VALIDATED** - Passed validation checks
- **APPROVED** - Human approved
- **PROMOTED** - Moved to knowledge

## Related Directories

| Directory | Phase |
|-----------|-------|
| `investigations/` | Research phase |
| `experiments/` | Laboratory phase |
| `evidence/` | Accumulated evidence |

## Source

This structure follows the Scientific Learning Loop defined in SEED-001.

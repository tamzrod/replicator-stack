# Laboratory Evidence

**Phase**: Evidence Accumulation

## Purpose

This directory contains **Evidence** - accumulated findings from the Scientific Learning Loop.

## Workflow Position

```
Research ──creates──► Knowledge ──tests──► Laboratory
    ▲                                       │
    │                                       ▼
    │            Governance ──directs──► Evidence
    │              │
    └───────informs
```

## Evidence Categories

Evidence must be categorized using markup:

| Category | Markup | Example |
|----------|--------|---------|
| **Evidence** | `[EVIDENCE: source]` | `[EVIDENCE: KDE governance documentation]` |
| **Inference** | `[INFERENCE: conclusion]` | `[INFERENCE: Therefore, the pattern holds]` |
| **Hypothesis** | `Hypothesis:` | `Hypothesis: This may be caused by...` |

## Evidence Requirements

1. **Verified Source** - All evidence must cite a verifiable source
2. **Link to Source** - Evidence must be linked to the experiment/investigation that produced it
3. **Integrity Hash** - Each evidence file should have an integrity hash for verification

## Naming Convention

Evidence files are linked to their source:

```
evidence/
├── INV-XXX-YYY.md      # Evidence from investigation
├── LAB-XXX-YYY.md      # Evidence from experiment
└── aggregate/
    └── EVIDENCE-YYY.md  # Cross-experiment aggregates
```

## Governance Review

Evidence informs Governance decisions:

- **8. Review Evidence** - Governance evaluates findings
- **9. Approve/Reject** - Human decision on recommendations
- **10. Direct Research** - Set priorities for next cycle

## Related Directories

| Directory | Phase |
|-----------|-------|
| `investigations/` | Research phase |
| `experiments/` | Laboratory phase |
| `validations/` | Validation results |

## Source

This structure follows the Scientific Learning Loop defined in SEED-001.

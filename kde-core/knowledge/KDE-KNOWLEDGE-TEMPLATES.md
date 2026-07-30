# KDE Knowledge Document Templates

**Document ID**: KDE-KNOWLEDGE-TEMPLATES-001
**Title**: Knowledge Document Templates
**Version**: 2.0.0
**Status**: APPROVED
**Confidence**: HIGH
**Class**: ARCHITECTURE
**Author**: KDE Governance
**Authority**: LAB-024 Arbitration Verdict, INV-AUDIT-REVIEW-001
**Effective Date**: 2026-07-27
**Source Investigation**: LAB-024, INV-AUDIT-REVIEW-001
**Approved By**: KDE Governance
**Promoted**: 2026-07-27
**Change**: Added Investigation Provenance (Engine/Seed) to all templates per INV-AUDIT-REVIEW-001

---

## Purpose

This document provides standardized templates for each Knowledge Document class. Templates ensure consistency, completeness, and compliance with the Knowledge Document Specification.

---

## Template: Foundational Document

### Purpose
Establish philosophical/epistemological foundations for KDE concepts.

### Template

```markdown
# [Title]

**Knowledge ID**: KDE-XXX
**Title**: [Document Title]
**Class**: FOUNDATIONAL
**Version**: 0.1.0
**Status**: DRAFT
**Confidence**: [LOW|MEDIUM|HIGH]
**Evidence Level**: [1-5]
**Owner**: [Owner]
**Created**: YYYY-MM-DDTHH:MM:SSZ
**Updated**: YYYY-MM-DDTHH:MM:SSZ
**Reviewed**: YYYY-MM-DD
**Source Investigation**: INV-XXX
**Evidence**:
  - EV-XXX
**Approver**: [Name] (required for PROMOTED)

---

## Definition

[One-paragraph definition of the concept]

---

## Summary

[Brief overview of the concept (2-3 paragraphs)]

---

## Discipline Analysis

### Philosophy

[How philosophy addresses this concept]

### Epistemology

[How epistemology addresses this concept]

### Science

[How science addresses this concept]

### Engineering

[How engineering addresses this concept]

---

## Evidence

### Supporting Evidence

| Evidence ID | Description | Source |
|-------------|-------------|--------|
| EV-XXX | [Description] | [Source] |

### Contradicting Evidence

| Evidence ID | Description | Impact |
|-------------|-------------|--------|
| [if any] | [Description] | [Minor/Major/Critical] |

---

## Validation Plan

[How this definition will be validated]

### Test 1: [Name]

[Description of test]

### Test 2: [Name]

[Description of test]

---

## Validation Results

[Results of validation tests]

### Test 1: [Name]

**Result**: [PASS|FAIL]
**Evidence**: [Evidence]

### Test 2: [Name]

**Result**: [PASS|FAIL]
**Evidence**: [Evidence]

---

## Confidence Assessment

| Factor | Assessment | Rationale |
|--------|------------|-----------|
| Evidence Quality | [LOW/MEDIUM/HIGH] | [Rationale] |
| Reproducibility | [LOW/MEDIUM/HIGH] | [Rationale] |
| Consistency | [LOW/MEDIUM/HIGH] | [Rationale] |

**Overall Confidence**: [LOW/MEDIUM/HIGH]

---

## Dependencies

- [KDE-XXX: Title] — Why needed

---

## Related Knowledge

- [KDE-XXX: Title] — Cross-reference

---

## Revision History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1.0 | YYYY-MM-DD | Initial draft | [Name] |

---

## Provenance

### Investigation Provenance (NEW)

| Field | Value | Description |
|-------|-------|-------------|
| Investigation | INV-XXX | Investigation that produced this knowledge |
| Engine | KDE-ENGINE-XXX (vX.Y.Z) | Engine used (v3.0.0+ template) |
| Seed | SEED-XXX (vX.Y.Z) | Seed used (v3.0.0+ template) |
| Investigation Date | YYYY-MM-DD | When investigation was conducted |

### Evidence Provenance

| Source | Reference | Date | Evidence ID |
|--------|-----------|------|-------------|
| Investigation | INV-XXX | YYYY-MM-DD | - |
| Evidence | EV-XXX | YYYY-MM-DD | EV-XXX |
| External Source | [Source] | YYYY-MM-DD | - |

### Validation Provenance

| Stage | Validator | Date | Notes |
|-------|-----------|------|-------|
| Candidate | [Name] | YYYY-MM-DD | [Notes] |
| Validated | [Name] | YYYY-MM-DD | [Notes] |
| Promoted | [Name] | YYYY-MM-DD | [Notes] |

### Knowledge Dependencies

| Knowledge ID | Relationship | Version |
|--------------|--------------|---------|
| KDE-XXX | Depends on | v1.0.0 |
| KDE-YYY | Related to | v2.0.0 |

**Why Provenance Matters**: Provenance enables:
- Tracing knowledge back to source investigations
- Verifying knowledge was derived from correct methodology
- Understanding knowledge dependencies
- Reproducing knowledge derivation if needed
```

---

## Template: Architecture Document

### Purpose
Define KDE system architecture and specifications.

### Template

```markdown
# [Title]

**Knowledge ID**: KDE-ARCH-XXX
**Title**: [Document Title]
**Class**: ARCHITECTURE
**Version**: 1.0.0
**Status**: DRAFT
**Confidence**: [LOW|MEDIUM|HIGH]
**Evidence Level**: [1-5]
**Owner**: [Owner]
**Created**: YYYY-MM-DDTHH:MM:SSZ
**Updated**: YYYY-MM-DDTHH:MM:SSZ
**Reviewed**: YYYY-MM-DD
**Source Investigation**: INV-XXX
**Evidence**:
  - EV-XXX
**Approver**: [Name] (required for PROMOTED)

---

## Definition

[One-paragraph definition of the architectural specification]

---

## Summary

[Brief overview of the architecture (2-3 paragraphs)]

---

## Core Principles

### Principle 1: [Name]

**Statement**: [Clear statement]

**Rationale**: [Why this principle exists]

### Principle 2: [Name]

**Statement**: [Clear statement]

**Rationale**: [Why this principle exists]

---

## Specification

[Detailed architectural specification]

---

## Supporting Experiments

| Experiment | Purpose | Result |
|------------|---------|--------|
| LAB-XXX | [Purpose] | [Result] |

---

## Dependencies

- [KDE-ARCH-XXX: Title] — Why needed

---

## Related Knowledge

- [KDE-ARCH-XXX: Title] — Cross-reference

---

## Confidence Assessment

| Factor | Assessment | Rationale |
|--------|------------|-----------|
| Evidence Quality | [LOW/MEDIUM/HIGH] | [Rationale] |
| Reproducibility | [LOW/MEDIUM/HIGH] | [Rationale] |
| Consistency | [LOW/MEDIUM/HIGH] | [Rationale] |

**Overall Confidence**: [LOW/MEDIUM/HIGH]

---

## Governance Authority

[KDE-GOV-XXX]: [Rule description]

---

## Revision History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0.0 | YYYY-MM-DD | Initial promotion | [Name] |

---

## Provenance

### Investigation Provenance (v2.0.0)

| Field | Value | Description |
|-------|-------|-------------|
| Investigation | INV-XXX | Investigation that produced this knowledge |
| Engine | KDE-ENGINE-XXX (vX.Y.Z) | Engine used |
| Seed | SEED-XXX (vX.Y.Z) | Seed used |
| Investigation Date | YYYY-MM-DD | When investigation was conducted |

### Evidence Provenance

| Source | Reference | Date | Evidence ID |
|--------|-----------|------|-------------|
| Investigation | INV-XXX | YYYY-MM-DD | - |
| Evidence | EV-XXX | YYYY-MM-DD | EV-XXX |

### Validation Provenance

| Stage | Validator | Date | Notes |
|-------|-----------|------|-------|
| Candidate | [Name] | YYYY-MM-DD | [Notes] |
| Validated | [Name] | YYYY-MM-DD | [Notes] |
| Promoted | [Name] | YYYY-MM-DD | [Notes] |

### Knowledge Dependencies

| Knowledge ID | Relationship | Version |
|--------------|--------------|---------|
| KDE-XXX | Depends on | v1.0.0 |
| KDE-YYY | Related to | v2.0.0 |

---

## Reference

- [Link to related documents]
```

---

## Template: Domain Document

### Purpose
Document engineering practice within a specific domain.

### Template

```markdown
# [Title]

**Knowledge ID**: KDE-[DOMAIN]-XXX
**Title**: [Document Title]
**Class**: DOMAIN
**Domain**: [gis|typography|visualization|utility-sld]
**Version**: 1.0.0
**Status**: DRAFT
**Confidence**: [LOW|MEDIUM|HIGH]
**Evidence Level**: [1-5]
**Owner**: [Owner]
**Created**: YYYY-MM-DDTHH:MM:SSZ
**Updated**: YYYY-MM-DDTHH:MM:SSZ
**Reviewed**: YYYY-MM-DD
**Source Investigation**: INV-XXX
**Source Engine**: KDE-ENGINE-XXX (vX.Y.Z) (NEW)
**Source Seed**: SEED-XXX (vX.Y.Z) (NEW)
**Evidence**:
  - EV-XXX
**Approver**: [Name] (required for PROMOTED)
**External Source**:
  - name: [Source name]
    url: [URL]

---

## Definition

[One-paragraph definition of domain scope]

**Note**: This section MAY use "Overview" instead of "Definition" for documents that describe domain scope rather than providing a definitional statement.

---

## Summary

[Brief overview of the domain knowledge (2-3 paragraphs)]

---

## Design Rules

### Rule 1: [Name]

**Statement**: [Clear, actionable statement]

**Implementation**:
```[language]
code example
```

**Rationale**: [Why this rule exists]

### Rule 2: [Name]

**Statement**: [Clear, actionable statement]

**Implementation**:
```[language]
code example
```

**Rationale**: [Why this rule exists]

---

## Evidence

### Supporting Evidence

| Evidence ID | Description | Source |
|-------------|-------------|--------|
| EV-XXX | [Description] | [Source] |

### External Sources

| Source | Name | Citation |
|--------|------|----------|
| Standard | [Name] | [Citation] |
| Publication | [Title] | [Citation] |

---

## Confidence Assessment

| Factor | Assessment | Rationale |
|--------|------------|-----------|
| Evidence Quality | [LOW/MEDIUM/HIGH] | [Rationale] |
| Reproducibility | [LOW/MEDIUM/HIGH] | [Rationale] |
| Consistency | [LOW/MEDIUM/HIGH] | [Rationale] |

**Overall Confidence**: [LOW/MEDIUM/HIGH]

---

## Dependencies

- [KDE-XXX: Title] — Why needed

---

## Related Knowledge

- [KDE-XXX: Title] — Cross-reference

---

## Revision History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0.0 | YYYY-MM-DD | Initial promotion | [Name] |

---

## Provenance

| Source | Reference | Date |
|--------|-----------|------|
| Investigation | INV-XXX | YYYY-MM-DD |
| Evidence | EV-XXX | YYYY-MM-DD |
| External Source | [Source] | [Date] |
| Validation | [Validator] | YYYY-MM-DD |
| Promotion | [Approver] | YYYY-MM-DD |
```

---

## Template: Governance Document

### Purpose
Define rules, processes, and policies.

### Template

```markdown
# [Title]

**Knowledge ID**: KDE-GOV-XXX
**Title**: [Document Title]
**Class**: GOVERNANCE
**Version**: 1.0.0
**Status**: DRAFT
**Confidence**: [LOW|MEDIUM|HIGH]
**Evidence Level**: [1-5]
**Owner**: [Owner]
**Created**: YYYY-MM-DDTHH:MM:SSZ
**Updated**: YYYY-MM-DDTHH:MM:SSZ
**Reviewed**: YYYY-MM-DD
**Source Investigation**: INV-XXX
**Source Engine**: KDE-ENGINE-XXX (vX.Y.Z) (NEW)
**Source Seed**: SEED-XXX (vX.Y.Z) (NEW)
**Evidence**:
  - EV-XXX
**Approver**: [Name] (required for PROMOTED)

---

## Definition

[One-paragraph definition of the governance rule]

---

## Rules

### Rule 1: [Name]

**Statement**: [Clear rule statement]

**Implementation**:
- [Requirement 1]
- [Requirement 2]

### Rule 2: [Name]

**Statement**: [Clear rule statement]

**Implementation**:
- [Requirement 1]
- [Requirement 2]

---

## Enforcement

[How rules are enforced]

### Monitoring

[How compliance is monitored]

### Violations

[How violations are handled]

---

## Exceptions

| Exception | Conditions | Authority |
|-----------|------------|-----------|
| [Name] | [Conditions] | [Authority] |

---

## Evidence

### Supporting Evidence

| Evidence ID | Description | Source |
|-------------|-------------|--------|
| EV-XXX | [Description] | [Source] |

---

## Confidence Assessment

| Factor | Assessment | Rationale |
|--------|------------|-----------|
| Evidence Quality | [LOW/MEDIUM/HIGH] | [Rationale] |
| Reproducibility | [LOW/MEDIUM/HIGH] | [Rationale] |
| Consistency | [LOW/MEDIUM/HIGH] | [Rationale] |

**Overall Confidence**: [LOW/MEDIUM/HIGH]

---

## Revision History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0.0 | YYYY-MM-DD | Initial promotion | [Name] |

---

## Provenance

| Source | Reference | Date |
|--------|-----------|------|
| Investigation | INV-XXX | YYYY-MM-DD |
| Evidence | EV-XXX | YYYY-MM-DD |
| Validation | [Validator] | YYYY-MM-DD |
| Promotion | [Approver] | YYYY-MM-DD |
```

---

## Template: Argumentation Document

### Purpose
Document reasoning and decision-making.

### Template

```markdown
# [Title]

**Knowledge ID**: KDE-ARG-XXX
**Title**: [Document Title]
**Class**: ARGUMENTATION
**Subtype**: [DECISION|TRADEOFF|JUSTIFICATION]
**Version**: 1.0.0
**Status**: DRAFT
**Confidence**: [LOW|MEDIUM|HIGH]
**Evidence Level**: [1-5]
**Owner**: [Owner]
**Created**: YYYY-MM-DDTHH:MM:SSZ
**Updated**: YYYY-MM-DDTHH:MM:SSZ
**Reviewed**: YYYY-MM-DD
**Source Investigation**: INV-XXX
**Source Engine**: KDE-ENGINE-XXX (vX.Y.Z) (NEW)
**Source Seed**: SEED-XXX (vX.Y.Z) (NEW)
**Evidence**:
  - EV-XXX
**Approver**: [Name] (required for PROMOTED)

---

## Definition

[One-paragraph definition of the decision or question]

---

## Decision/Question

[The decision being made or question being answered]

---

## Options Considered

### Option 1: [Name]

**Description**: [Description]

**Pros**:
- [Pro 1]
- [Pro 2]

**Cons**:
- [Con 1]
- [Con 2]

### Option 2: [Name]

**Description**: [Description]

**Pros**:
- [Pro 1]

**Cons**:
- [Con 1]

---

## Decision Made

**Chosen**: [Option name]

**Date**: YYYY-MM-DD

---

## Rationale

[Why this decision was made]

### Key Factors

1. [Factor 1]
2. [Factor 2]

### Trade-offs

[The trade-offs considered]

---

## Evidence

### Supporting Evidence

| Evidence ID | Description | Source |
|-------------|-------------|--------|
| EV-XXX | [Description] | [Source] |

---

## Conditions

### When to Apply

[Conditions under which this decision applies]

### When Not to Apply

[Conditions under which this decision does not apply]

---

## Confidence Assessment

| Factor | Assessment | Rationale |
|--------|------------|-----------|
| Evidence Quality | [LOW/MEDIUM/HIGH] | [Rationale] |
| Reproducibility | [LOW/MEDIUM/HIGH] | [Rationale] |
| Consistency | [LOW/MEDIUM/HIGH] | [Rationale] |

**Overall Confidence**: [LOW/MEDIUM/HIGH]

---

## Revision History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0.0 | YYYY-MM-DD | Initial promotion | [Name] |

---

## Provenance

| Source | Reference | Date |
|--------|-----------|------|
| Investigation | INV-XXX | YYYY-MM-DD |
| Evidence | EV-XXX | YYYY-MM-DD |
| Validation | [Validator] | YYYY-MM-DD |
| Promotion | [Approver] | YYYY-MM-DD |
```

---

## References

| Document | Relationship |
|----------|--------------|
| KDE-KNOWLEDGE-DOCUMENT-SPECIFICATION.md | Parent specification |
| KDE-KNOWLEDGE-TAXONOMY.md | Document classification |
| KDE-KNOWLEDGE-LIFECYCLE.md | Lifecycle states |

---

## Version History

| Version | Date | Changes | Authority |
|---------|------|---------|-----------|
| 2.0.0 | 2026-07-27 | Added Investigation Provenance (Engine/Seed) | INV-AUDIT-REVIEW-001 |
| 1.0.0 | 2026-07-21 | Initial templates | LAB-024 Verdict |

---

**Document Status**: APPROVED
**Authority**: LAB-024 Arbitration, INV-AUDIT-REVIEW-001
**Compliance**: MANDATORY
**Change Note**: Templates now require Engine and Seed provenance for reproducibility.

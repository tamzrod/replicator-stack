# KDE Knowledge Document Lifecycle

**Document ID**: KDE-KNOWLEDGE-LIFECYCLE-001
**Title**: Knowledge Document Lifecycle
**Version**: 1.0.0
**Status**: APPROVED
**Confidence**: HIGH
**Class**: ARCHITECTURE
**Author**: KDE Governance
**Authority**: LAB-024 Arbitration Verdict
**Effective Date**: 2026-07-21
**Source Investigation**: LAB-022, LAB-024
**Approved By**: KDE Governance
**Promoted**: 2026-07-21

---

## Purpose

This document defines the lifecycle states, transitions, and governance for Knowledge Documents. It establishes how Knowledge Documents are created, validated, promoted, and deprecated.

---

## Lifecycle States

### State Diagram

```
┌─────────┐
│  DRAFT  │
└────┬────┘
     │ Create/Edit
     ▼
┌─────────┐
│ CANDIDATE│
└────┬────┘
     │ Validate
     ▼
┌──────────┐
│ VALIDATED│
└────┬─────┘
     │ Approve
     ▼
┌─────────┐
│ PROMOTED│
└────┬────┘
     │ Supersede
     ▼
┌───────────┐
│ DEPRECATED│
└───────────┘
```

### State Definitions

| State | Description | AI Can Set | Human Must Set |
|-------|-------------|------------|----------------|
| DRAFT | Work in progress | Yes | - |
| CANDIDATE | Ready for review | Yes | - |
| VALIDATED | Passed validation | Yes | - |
| PROMOTED | In Knowledge Repository | No | Yes |
| DEPRECATED | Superseded or invalid | No | Yes |

### State Descriptions

#### DRAFT

The document is being developed. Content is subject to change.

**Entry**: Document created
**Exit**: Author determines ready for review
**AI**: Can set to DRAFT, can modify content

#### CANDIDATE

The document is ready for validation. All required content is present.

**Entry**: Author/submitter completes document
**Exit**: Validator approves or returns to DRAFT
**AI**: Can set to CANDIDATE, can modify content

#### VALIDATED

The document has passed validation. Content is stable.

**Entry**: Validator approves
**Exit**: Approver promotes or returns to DRAFT
**AI**: Can set to VALIDATED, modifications require return to DRAFT

#### PROMOTED

The document is official KDE Knowledge. Content is canonical.

**Entry**: Human approver accepts
**Exit**: Human approver deprecates or new version promoted
**AI**: Cannot set. Cannot modify content directly.

#### DEPRECATED

The document is no longer current. Preserved for traceability.

**Entry**: Human approver deprecates
**Exit**: N/A (terminal state)
**AI**: Cannot set. Document remains readable.

---

## State Transitions

### Transition Table

| From | To | Authority | Evidence Required |
|------|-----|-----------|-------------------|
| (new) | DRAFT | Investigator | None |
| DRAFT | CANDIDATE | Investigator | Document complete |
| CANDIDATE | DRAFT | Validator | Review comments |
| CANDIDATE | VALIDATED | Validator | Validation passed |
| VALIDATED | DRAFT | Approver | Change request |
| VALIDATED | PROMOTED | Approver | Approval granted |
| PROMOTED | DEPRECATED | Approver | Deprecation reason |
| DEPRECATED | DRAFT | Approver | Major revision |
| PROMOTED | DRAFT | Approver | Correction needed |

### Transition Evidence

#### DRAFT → CANDIDATE

Required:
- All required sections present
- Required metadata complete
- Self-validation passed

#### CANDIDATE → VALIDATED

Required:
- External review (if required)
- Evidence verification
- Validation tests passed
- No outstanding issues

#### VALIDATED → PROMOTED

Required:
- Human approval
- Ownership transfer to Governance
- Promotion timestamp
- Approver name

#### PROMOTED → DEPRECATED

Required:
- Deprecation reason
- Superseded-by reference
- Deprecation date
- Approver name

---

## Validation Requirements

### Validation Levels

| Level | Evidence Required | Review Required | Examples |
|-------|------------------|-----------------|----------|
| 1 | Single execution | Internal | Initial drafts |
| 2 | Multiple runs | Internal + Peer | Candidate documents |
| 3 | Cross-method validation | External | Architecture specs |
| 4 | Cross-domain validation | Domain experts | Foundational concepts |
| 5 | Sustained no contradictions | Governance | Established knowledge |

### Validation Checklist

| Check | Required For | Description |
|-------|-------------|-------------|
| Metadata complete | All states | All required fields present |
| Sections complete | All states | All required sections present |
| Provenance complete | CANDIDATE+ | Investigation and evidence linked |
| Evidence verified | VALIDATED | Evidence exists and is valid |
| Human approval | PROMOTED | Named approver recorded |
| Deprecation reason | DEPRECATED | Reason documented |

---

## Provenance Requirements

### At Promotion

Every PROMOTED document SHALL have:

```yaml
---
promoted: YYYY-MM-DD
approver: [Full Name]
---
```

### Provenance Chain

```
Investigation (INV-XXX)
    │
    ├──► Synthesis (in investigation)
    │
    └──► Conclusion (in investigation)
              │
              ▼
        Validation (validated.md)
              │
              ▼
        Promotion Proposal (proposal.md)
              │
              ▼
        Human Approval
              │
              ▼
        Knowledge (PROMOTED)
```

### Provenance Documentation

Every Knowledge Document SHALL document:

```markdown
## Provenance

| Source | Reference | Date |
|--------|-----------|------|
| Investigation | INV-XXX | YYYY-MM-DD |
| Evidence | EV-XXX, EV-YYY | YYYY-MM-DD |
| Validation | [Validator] | YYYY-MM-DD |
| Promotion | [Approver] | YYYY-MM-DD |
```

---

## Deprecation

### Reasons for Deprecation

| Reason | Description |
|--------|-------------|
| Superseded | New version replaces this |
| Invalid | Found to be incorrect |
| Obsolete | No longer applicable |
| Deprecated | Deliberately deprecated |

### Deprecation Process

1. Set `status: DEPRECATED`
2. Set `supersedes: [Document ID]` on replacement
3. Add deprecation notice
4. Record deprecation date and reason
5. Preserve document (never delete)

### Deprecation Notice

Every deprecated document SHALL include:

```markdown
---

## Deprecation Notice

**Status**: DEPRECATED
**Deprecated**: YYYY-MM-DD
**Deprecated By**: [Name]
**Reason**: [Reason]
**Superseded By**: [Document ID or N/A]

> This document has been deprecated and is preserved for historical reference.
> See [Superseded By] for current guidance.

---
```

---

## Version Management

### Version Numbering

Semantic versioning: MAJOR.MINOR.PATCH

| Increment | When | Example |
|-----------|------|---------|
| MAJOR | Fundamental change to definition | 1.0.0 → 2.0.0 |
| MINOR | Added sections, expanded guidance | 1.0.0 → 1.1.0 |
| PATCH | Corrections, clarifications | 1.0.0 → 1.0.1 |

### Version History

Every Knowledge Document SHALL include:

```markdown
## Revision History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 2.0.0 | YYYY-MM-DD | Major revision | [Name] |
| 1.1.0 | YYYY-MM-DD | Minor addition | [Name] |
| 1.0.0 | YYYY-MM-DD | Initial promotion | [Name] |
```

---

## References

| Document | Relationship |
|----------|--------------|
| KDE-KNOWLEDGE-DOCUMENT-SPECIFICATION.md | Parent specification |
| KDE-KNOWLEDGE-TAXONOMY.md | Document classification |
| KDE-KNOWLEDGE-METADATA-SCHEMA.md | Metadata requirements |

---

## Version History

| Version | Date | Changes | Authority |
|---------|------|---------|-----------|
| 1.0.0 | 2026-07-21 | Initial lifecycle | LAB-024 Verdict |

---

**Document Status**: APPROVED
**Authority**: LAB-024 Arbitration
**Compliance**: MANDATORY

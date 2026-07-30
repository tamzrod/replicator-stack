# KDE Knowledge Document Specification

**Document ID**: KDE-KNOWLEDGE-SPEC-001
**Title**: Knowledge Document Specification
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

This specification establishes the authoritative standard for all KDE Knowledge Documents. It defines what constitutes a Knowledge Document, its structure, classification, lifecycle, and governance requirements.

This specification was approved through the KDE governance process (LAB-020 through LAB-024) and is mandatory for all Knowledge Documents.

---

## Definition

### What is a Knowledge Document?

A **Knowledge Document** is a validated, provenance-tracked artifact that records actionable understanding for engineering practice. It has the following characteristics:

| Characteristic | Description |
|----------------|-------------|
| **Validated** | Passed evidence-based validation |
| **Provenance-tracked** | Links to investigation and evidence |
| **Actionable** | Enables effective engineering practice |
| **Owned by Governance** | Ownership transferred at promotion |
| **Official** | Represents canonical KDE understanding |

### What Distinguishes Knowledge from Investigation?

| Aspect | Investigation | Knowledge |
|--------|--------------|-----------|
| Purpose | Discover truth | Record truth |
| Owner | Investigation subsystem | Governance |
| State | ACTIVE → COMPLETE | DRAFT → PROMOTED |
| Content | Hypotheses, experiments, evidence | Definitions, rules, guidance |
| Audience | AI executing research | Engineers applying knowledge |
| Lifecycle | Finite (concludes) | Indefinite (evolves) |

---

## Document Taxonomy

### Five Document Classes

Knowledge Documents are classified into five mutually exclusive classes:

| Class | Purpose | Examples |
|-------|---------|----------|
| **Foundational** | Philosophical/epistemological foundations | What is Knowledge?, What is Evidence? |
| **Architecture** | KDE system architecture specifications | KDE-ARCH-001 through KDE-ARCH-010 |
| **Domain** | Engineering practice within a domain | GIS, Typography, Visualization standards |
| **Governance** | Rules, processes, policies | Promotion rules, validation standards |
| **Argumentation** | Decision rationale, tradeoff analysis | Design decisions, tradeoffs |

### Class Definitions

#### Foundational (Class ID: FOUND)

**Purpose**: Establish philosophical/epistemological foundations for KDE concepts.

**Scope**: Definitions of core concepts, validation methodology, epistemological grounding.

**Example**: `001-what-is-knowledge.md`

#### Architecture (Class ID: ARCH)

**Purpose**: Define KDE system architecture and specifications.

**Scope**: System structure, interfaces, protocols, standards, specifications.

**Subtypes**:
- KDE System Architecture: KDE-wide specifications
- Domain Architecture: Domain-specific patterns

**Example**: `KDE-ARCH-001.md`

#### Domain (Class ID: DOMAIN)

**Purpose**: Document engineering practice within a specific domain.

**Scope**: Design rules, best practices, domain-specific guidance.

**Required Metadata**: `domain` field (e.g., GIS, Typography, Visualization)

**Example**: `gis/design-rules.md`

#### Governance (Class ID: GOV)

**Purpose**: Define rules, processes, and policies.

**Scope**: Promotion rules, validation requirements, governance standards.

**Example**: `KDE-GOV-001.md`

#### Argumentation (Class ID: ARG)

**Purpose**: Document reasoning and decision-making.

**Scope**: Decision rationale, tradeoff analysis, options considered.

**Subtypes**:
- Decision Rationale: Why a decision was made
- Tradeoff Analysis: Comparison of alternatives

**Example**: `KDE-ARCH-010.md` (Tradeoffs)

---

## Metadata Specification

### Required Metadata

Every Knowledge Document SHALL include the following metadata:

```yaml
---
id: KDE-XXX                    # Unique identifier (required)
title: [Document Title]        # Descriptive title (required)
class: [CLASS]                 # FOUND|ARCH|DOMAIN|GOV|ARG (required)
version: X.Y.Z                 # Semantic version (required)
status: [STATE]                # DRAFT|CANDIDATE|VALIDATED|PROMOTED|DEPRECATED (required)
confidence: [LEVEL]            # LOW|MEDIUM|HIGH (required)
evidence-level: [1-5]          # Maturity level (required)
owner: [Owner]                 # Owner entity (required)
created: YYYY-MM-DDTHH:MM:SSZ  # Creation timestamp (required)
updated: YYYY-MM-DDTHH:MM:SSZ   # Last modification (required)
reviewed: YYYY-MM-DD            # Last review date (required)
source-investigation: INV-XXX   # Origin investigation (required)
evidence:                       # Supporting evidence IDs (required)
  - EV-XXX
approver: [Name]               # Human approver (required for PROMOTED)
---
```

### Optional Metadata

```yaml
domain: [Domain]                # Domain name for DOMAIN class
category: [Category]           # Additional category
related:                        # Related Knowledge IDs
  - KDE-XXX
supersedes: [KDE-XXX]         # Replaced document
valid-until: YYYY-MM-DD         # Expiration for time-limited knowledge
external-source:               # External source for domain knowledge
  - name: [Source name]
    url: [URL]
    citation: [Citation]
```

### Metadata Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | String | Yes | Unique Knowledge ID |
| title | String | Yes | Descriptive title |
| class | Enum | Yes | Document class |
| version | String | Yes | Semantic version (X.Y.Z) |
| status | Enum | Yes | Document state |
| confidence | Enum | Yes | Confidence level |
| evidence-level | Integer | Yes | Maturity level (1-5) |
| owner | String | Yes | Owner entity |
| created | Timestamp | Yes | Creation time |
| updated | Timestamp | Yes | Last modification |
| reviewed | Date | Yes | Last review |
| source-investigation | String | Yes | Origin investigation |
| evidence | Array | Yes | Evidence IDs |
| approver | String | Conditional | Required for PROMOTED |
| domain | String | Conditional | Required for DOMAIN class |
| related | Array | No | Related Knowledge IDs |
| supersedes | String | No | Replaced document ID |
| valid-until | Date | No | Expiration date |
| external-source | Array | No | External sources |

---

## Required Sections

Every Knowledge Document SHALL include the following sections:

### 1. Definition

One-paragraph statement of what is known.

**Note for DOMAIN class**: MAY use "Overview" instead of "Definition" if the section describes domain scope rather than a definitional statement.

### 2. Summary

2-3 paragraph overview of the knowledge.

### 3. Evidence

Supporting evidence with references.

Shall include:
- Supporting evidence table
- Contradicting evidence (if any)
- Evidence assessment

### 4. Provenance

Complete traceability chain.

Shall include:
- Source investigation
- Evidence references
- Validation records
- External sources (if applicable)

---

## Optional Sections

| Section | Description | Recommended For |
|---------|-------------|-----------------|
| Dependencies | Prerequisites | All classes |
| Related Knowledge | Cross-references | All classes |
| Limitations | Known constraints | All classes |
| Trade-offs | Design decisions | ARCH, ARG |
| Usage | How to apply | DOMAIN |
| Examples | Code, diagrams | DOMAIN |
| Discipline Analysis | Philosophy grounding | FOUND |
| Validation Plan | How validated | FOUND |
| Revision History | Version changes | All classes |

---

## Prohibited Content

Knowledge Documents SHALL NOT include:

1. **Hypotheses** — Only validated conclusions
2. **Raw experiment data** — Summarize as evidence
3. **AI process documentation** — Belongs in Laboratory
4. **Personal opinions** — Must be evidence-based
5. **Unverified claims** — Mark as hypothesis if necessary
6. **Investigation artifacts** — Belongs in Laboratory

---

## Lifecycle

### Document States

```
DRAFT → CANDIDATE → VALIDATED → PROMOTED → DEPRECATED
```

| State | Description | Human Required |
|-------|-------------|-----------------|
| DRAFT | Work in progress | No |
| CANDIDATE | Ready for review | No |
| VALIDATED | Passed validation | No |
| PROMOTED | In Knowledge Repository | YES |
| DEPRECATED | Superseded or invalid | YES |

### State Transitions

| From | To | Authority |
|------|-----|----------|
| DRAFT | CANDIDATE | Investigator |
| CANDIDATE | VALIDATED | Validator |
| VALIDATED | PROMOTED | Human Approver |
| PROMOTED | DEPRECATED | Human Approver |
| Any | DRAFT | Human Approver (revert) |

### Evidence Maturity Levels

| Level | Name | Description | Requirements |
|-------|------|-------------|--------------|
| 1 | Experimental | Single successful execution | 1 run |
| 2 | Repeatable | Multiple runs under same conditions | 10+ runs |
| 3 | Reproducible | Different methodologies converge | 60+ runs |
| 4 | Generalized | Holds across domains | Domain validation |
| 5 | Established | No contradictory evidence | Sustained validation |

---

## Confidence Model

### Confidence Dimensions

| Dimension | LOW | MEDIUM | HIGH |
|-----------|-----|--------|------|
| Evidence Quality | Single source | Multiple sources | Verified, cross-referenced |
| Reproducibility | Not tested | Partial replication | Confirmed by others |
| Consistency | Contradictions exist | Mostly consistent | No contradictions |

### Confidence Assessment

Every Knowledge Document SHALL include a confidence assessment:

```markdown
## Confidence Assessment

| Factor | Assessment | Rationale |
|--------|------------|-----------|
| Evidence Quality | [LOW/MEDIUM/HIGH] | [Rationale] |
| Reproducibility | [LOW/MEDIUM/HIGH] | [Rationale] |
| Consistency | [LOW/MEDIUM/HIGH] | [Rationale] |

**Overall Confidence**: [LOW/MEDIUM/HIGH]
```

---

## Provenance Requirements

### Internal Provenance

Every Knowledge Document SHALL trace to:

| Source | Required | Format |
|--------|----------|--------|
| Investigation | Yes | INV-XXX |
| Evidence | Yes | EV-XXX, EV-YYY |
| Validator | Yes | [Name] |
| Approver | Yes (PROMOTED) | [Name] |
| Promotion Date | Yes (PROMOTED) | YYYY-MM-DD |

### External Provenance

For Domain Knowledge citing external sources:

```markdown
## External Sources

| Source | Name | URL | Citation |
|--------|------|-----|----------|
| Standard | [Name] | [URL] | [Citation] |
| Publication | [Title] | [URL] | [Citation] |
```

---

## Revision Policy

### Version Numbering

- **Major (X.0.0)**: Fundamental change to definition
- **Minor (0.X.0)**: Added sections, expanded guidance
- **Patch (0.0.X)**: Corrections, clarifications

### Revision History

Every Knowledge Document SHALL include:

```markdown
## Revision History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 2.0.0 | YYYY-MM-DD | Major revision | [Name] |
| 1.1.0 | YYYY-MM-DD | Minor addition | [Name] |
| 1.0.0 | YYYY-MM-DD | Initial promotion | [Name] |
```

### Deprecation

When deprecating knowledge:

1. Set `status: DEPRECATED`
2. Set `supersedes: [Document ID]`
3. Add deprecation notice
4. Preserve original (never delete)

---

## Class-Specific Requirements

### Foundational Documents

**Required Sections**:
1. Definition
2. Summary
3. Discipline Analysis (philosophy, epistemology, science, engineering)
4. Evidence
5. Provenance
6. Validation Plan
7. Validation Results

### Architecture Documents

**Required Sections**:
1. Definition
2. Core Principles
3. Supporting Experiments
4. Dependencies
5. Related Knowledge
6. Version History
7. Governance Authority
8. Reference

### Domain Documents

**Required Sections**:
1. Definition (or Overview)
2. Summary
3. Design Rules
4. Evidence
5. Provenance

**Note**: "Overview" MAY be used instead of "Definition" for domain scope.

### Governance Documents

**Required Sections**:
1. Definition
2. Rules
3. Enforcement
4. Exceptions
5. Provenance

### Argumentation Documents

**Required Sections**:
1. Definition (of decision/question)
2. Options Considered
3. Decision Made
4. Rationale
5. Evidence
6. Provenance

---

## Migration Notes

### Existing Documents

Existing Knowledge Documents SHALL be migrated to this standard by:

1. Adding missing required metadata
2. Adding required sections
3. Preserving all validated content
4. Preserving all provenance
5. Preserving revision history
6. Documenting migration

### Legacy Status Values

| Legacy | Standard |
|--------|----------|
| APPROVED | PROMOTED |
| REVIEW | CANDIDATE |
| CANDIDATE | CANDIDATE (retained) |

---

## References

| Document | Relationship |
|----------|--------------|
| LAB-022 | Original proposal |
| LAB-023 | Falsification |
| LAB-024 | Arbitration verdict |
| LAB-026 | Architectural classification |
| RULES.md | Laboratory Rules |
| SEED-001 | Five Core Principles |

---

## Version History

| Version | Date | Changes | Authority |
|---------|------|---------|-----------|
| 1.0.0 | 2026-07-21 | Initial approved specification | LAB-024 Verdict |

---

**Document Status**: APPROVED
**Authority**: LAB-024 Arbitration
**Compliance**: MANDATORY

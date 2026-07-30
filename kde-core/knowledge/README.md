# KDE Knowledge Repository

**Status**: APPROVED
**Standard**: [KDE-KNOWLEDGE-DOCUMENT-SPECIFICATION.md](./KDE-KNOWLEDGE-DOCUMENT-SPECIFICATION.md)
**Authority**: LAB-024 Arbitration Verdict

---

## Overview

The KDE Knowledge Repository contains validated, provenance-tracked artifacts that record actionable understanding for engineering practice.

---

## Repository Structure

```
knowledge/
├── README.md                          # This file
├── KDE-KNOWLEDGE-DOCUMENT-SPECIFICATION.md  # Official standard
├── KDE-KNOWLEDGE-TAXONOMY.md         # Document classification
├── KDE-KNOWLEDGE-LIFECYCLE.md        # Lifecycle states
├── KDE-KNOWLEDGE-TEMPLATES.md        # Document templates
├── foundational/                      # Foundational documents
│   ├── 001-what-is-knowledge.md
│   ├── 002-what-is-evidence.md
│   └── 003-what-is-ambiguity.md
├── architecture/                      # Architecture documents
│   ├── KDE-ARCH-001.md
│   └── ...
├── domain/                           # Domain documents
│   ├── gis/                         # Geographic Information Systems
│   ├── typography/                   # Typography and fonts
│   ├── visualization/                 # Data visualization
│   └── utility-sld/                  # Utility SCADA diagrams
└── governance/                       # Governance documents (when created)
```

---

## Document Classification

| Class | Purpose | Examples |
|-------|---------|----------|
| Foundational | Philosophical/epistemological foundations | What is Knowledge?, What is Evidence? |
| Architecture | KDE system architecture specifications | KDE-ARCH-001 through KDE-ARCH-010 |
| Domain | Engineering practice within a domain | GIS, Typography, Visualization standards |
| Governance | Rules, processes, policies | Promotion rules, validation standards |
| Argumentation | Decision rationale, tradeoff analysis | Design decisions, tradeoffs |

---

## Document Counts

| Class | Count |
|-------|-------|
| Foundational | 3 |
| Architecture | 16 |
| Domain | 45 |
| **Total** | **64** |

---

## Document Status

All documents in this repository have been migrated to the standard Knowledge Document format as specified in [KDE-KNOWLEDGE-DOCUMENT-SPECIFICATION.md](./KDE-KNOWLEDGE-DOCUMENT-SPECIFICATION.md).

### Migration Information

- **Migration Date**: 2026-07-21
- **Migration Authority**: IMPLEMENT-001
- **Source Investigation**: LAB-021, LAB-024
- **Removed**: 4 knowledge-summary files (Laboratory artifacts)

---

## Standards Compliance

Documents in this repository comply with:

- **KDE-KNOWLEDGE-DOCUMENT-SPECIFICATION.md**: Universal metadata, required sections, prohibited content
- **KDE-KNOWLEDGE-TAXONOMY.md**: Document classification and naming conventions
- **KDE-KNOWLEDGE-LIFECYCLE.md**: Lifecycle states and transitions
- **KDE-KNOWLEDGE-TEMPLATES.md**: Standardized document templates

---

## Adding Knowledge

### Process

1. Create document following [KDE-KNOWLEDGE-TEMPLATES.md](./KDE-KNOWLEDGE-TEMPLATES.md)
2. Set `status: DRAFT`
3. Complete required sections
4. Progress through lifecycle: DRAFT → CANDIDATE → VALIDATED → PROMOTED
5. Obtain human approval for PROMOTED state

### Required Metadata

```yaml
id: KDE-XXX
title: [Title]
class: [FOUND|ARCH|DOMAIN|GOV|ARG]
version: X.Y.Z
status: DRAFT
confidence: [LOW|MEDIUM|HIGH]
evidence-level: [1-5]
owner: [Owner]
created: YYYY-MM-DD
source-investigation: INV-XXX
evidence:
  - EV-XXX
```

---

## Architecture Documents

### KDE-ARCH Series (10 documents)

System architecture specifications (KDE-ARCH-001 through KDE-ARCH-010).

### KDE-DESKTOP Series (6 documents)

Desktop Runtime Architecture specifications extracted from INV-032:

| ID | Title | Status | Confidence |
|----|-------|--------|------------|
| KDE-DESKTOP-001 | Desktop Runtime Multi-Process Architecture | CANDIDATE | MEDIUM-HIGH |
| KDE-DESKTOP-002 | Desktop Runtime IPC Design Patterns | CANDIDATE | MEDIUM-HIGH |
| KDE-DESKTOP-003 | Desktop Runtime Selection Criteria | CANDIDATE | MEDIUM |
| KDE-DESKTOP-004 | Embedded Database Patterns | CANDIDATE | HIGH |
| KDE-DESKTOP-005 | Desktop Application Security Model | CANDIDATE | HIGH |
| KDE-DESKTOP-006 | Industrial Deployment Patterns | CANDIDATE | MEDIUM |

**Source**: [INV-032 Knowledge Extraction](../laboratory/investigations/INV-032/knowledge-extraction/)

---

## References

- [KDE-KNOWLEDGE-DOCUMENT-SPECIFICATION.md](./KDE-KNOWLEDGE-DOCUMENT-SPECIFICATION.md)
- [KDE-KNOWLEDGE-TAXONOMY.md](./KDE-KNOWLEDGE-TAXONOMY.md)
- [KDE-KNOWLEDGE-LIFECYCLE.md](./KDE-KNOWLEDGE-LIFECYCLE.md)
- [KDE-KNOWLEDGE-TEMPLATES.md](./KDE-KNOWLEDGE-TEMPLATES.md)
- [KDE-KNOWLEDGE-CLASSIFICATION-RULES.md](./KDE-KNOWLEDGE-CLASSIFICATION-RULES.md)
- [MIGRATION-PLAN.md](./MIGRATION-PLAN.md)

---

## Governance

This repository is governed by the rules specified in:
- [LABORATORY-RULES.md](../laboratory/RULES.md)
- [SEED-001](../seeds/seed-001/principles/5-principles.md)

Questions or issues should be directed to KDE Governance.

## Synthesis Objects (INV-015 to INV-020)


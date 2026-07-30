# KDE Knowledge Repository Taxonomy

**Document ID**: KDE-KNOWLEDGE-TAX-001
**Title**: Knowledge Repository Taxonomy
**Version**: 1.0.0
**Status**: APPROVED
**Confidence**: HIGH
**Class**: ARCHITECTURE
**Author**: KDE Governance
**Authority**: LAB-024 Arbitration Verdict
**Effective Date**: 2026-07-21
**Source Investigation**: LAB-021, LAB-024
**Approved By**: KDE Governance
**Promoted**: 2026-07-21

---

## Purpose

This document defines the official taxonomy for the KDE Knowledge Repository. It establishes the organizational structure, document classification rules, and naming conventions for all Knowledge Documents.

---

## Repository Structure

### Current Structure

```
knowledge/
├── README.md
├── 001-what-is-knowledge.md      # Foundational
├── 002-what-is-evidence.md        # Foundational
├── 003-what-is-ambiguity.md       # Foundational
├── KDE-ARCH-*.md                 # Architecture
├── KDE-GOV-*.md                  # Governance
├── gis/                          # Domain
├── typography/                    # Domain
├── visualization/                 # Domain
└── utility-sld/                   # Domain
```

### Approved Structure

```
knowledge/
├── README.md
├── foundational/                  # Foundational class
│   ├── 001-what-is-knowledge.md
│   ├── 002-what-is-evidence.md
│   └── 003-what-is-ambiguity.md
├── architecture/                # Architecture class
│   ├── KDE-ARCH-001.md
│   └── ...
├── domain/                        # Domain class (by domain)
│   ├── gis/
│   ├── typography/
│   ├── visualization/
│   └── utility-sld/
├── governance/                    # Governance class
│   ├── KDE-GOV-001.md
│   └── ...
└── argumentation/                 # Argumentation class
    └── KDE-ARG-001.md
```

---

## Document Classes

### Class: Foundational

**Purpose**: Establish philosophical/epistemological foundations for KDE concepts.

**Naming**: Sequential number prefix (001, 002, etc.)

**Examples**:
- `001-what-is-knowledge.md`
- `002-what-is-evidence.md`
- `003-what-is-ambiguity.md`

**Inclusion Rules**:
- Defines core KDE concepts
- Establishes methodology
- Provides epistemological grounding
- Does not belong to any specific domain

**Exclusion Rules**:
- Not domain-specific
- Not system specifications
- Not governance rules
- Not decision rationale

---

### Class: Architecture

**Purpose**: Define KDE system architecture and specifications.

**Naming**: `KDE-ARCH-NNN` prefix

**Examples**:
- `KDE-ARCH-001.md` (Architecture C Specification)
- `KDE-ARCH-002.md` (Ownership Principles)
- `KDE-ARCH-003.md` (Artifact Lifecycle)

**Subtypes**:

| Subtype | Description | Examples |
|---------|-------------|----------|
| System | KDE-wide specifications | ARCH-001, ARCH-002 |
| Pattern | Architectural patterns | ARCH-009 (SCADA Patterns) |
| Interface | System interfaces | Future interfaces |

**Inclusion Rules**:
- Defines system structure
- Establishes interfaces
- Sets architectural standards
- Specifies protocols

**Exclusion Rules**:
- Not domain-specific
- Not governance rules
- Not decision rationale

---

### Class: Domain

**Purpose**: Document engineering practice within a specific domain.

**Naming**: `domain/[domain-name]/` subdirectories

**Examples**:
- `domain/gis/design-rules.md`
- `domain/typography/fundamentals.md`
- `domain/visualization/colors.md`

**Domains**:

| Domain | Description | Example Documents |
|--------|-------------|-------------------|
| gis | Geographic Information Systems | design-rules, fundamentals, cartography |
| typography | Typography and fonts | fundamentals, hierarchy, accessibility |
| visualization | Data visualization | colors, components, types |
| utility-sld | Utility SCADA diagrams | principles, symbols, layout |

**Inclusion Rules**:
- Domain-specific knowledge
- Engineering guidance
- Design rules
- Best practices
- May cite external standards

**Exclusion Rules**:
- Not KDE system architecture
- Not governance rules
- Not philosophical foundations

---

### Class: Governance

**Purpose**: Define rules, processes, and policies.

**Naming**: `KDE-GOV-NNN` prefix

**Examples**:
- `KDE-GOV-001.md` (Promotion Rules)
- `KDE-GOV-002.md` (Validation Standards)

**Inclusion Rules**:
- Defines rules
- Establishes processes
- Sets policies
- Specifies standards

**Exclusion Rules**:
- Not system architecture
- Not domain knowledge
- Not decision rationale

---

### Class: Argumentation

**Purpose**: Document reasoning and decision-making.

**Naming**: `KDE-ARG-NNN` or `KDE-ARCH-NNN` (for ARCH documents with tradeoff analysis)

**Examples**:
- `KDE-ARCH-010.md` (SCADA Design Tradeoffs)
- `KDE-ARG-001.md` (Future argumentation documents)

**Subtypes**:

| Subtype | Description | Examples |
|---------|-------------|----------|
| Decision | Decision rationale | Why a choice was made |
| Tradeoff | Tradeoff analysis | Options considered,权衡 |
| Justification | Evidence-based justification | Why something is correct |

**Inclusion Rules**:
- Documents decisions
- Presents options
- Provides rationale
- Analyzes tradeoffs

**Exclusion Rules**:
- Not system specifications
- Not domain knowledge
- Not governance rules

---

## Naming Conventions

### Foundational Documents

Pattern: `NNN-[slug].md`

```
001-what-is-knowledge.md
002-what-is-evidence.md
003-what-is-ambiguity.md
```

### Architecture Documents

Pattern: `KDE-ARCH-NNN.md`

```
KDE-ARCH-001.md
KDE-ARCH-002.md
...
KDE-ARCH-010.md
```

### Domain Documents

Pattern: `domain/[domain]/[slug].md`

```
domain/gis/design-rules.md
domain/gis/fundamentals.md
domain/typography/fundamentals.md
```

### Governance Documents

Pattern: `KDE-GOV-NNN.md`

```
KDE-GOV-001.md
KDE-GOV-002.md
```

### Argumentation Documents

Pattern: `KDE-ARG-NNN.md` or reuse ARCH prefix for architecture-related

```
KDE-ARG-001.md
KDE-ARCH-010.md  (contains tradeoff analysis)
```

---

## Classification Rules

### Decision Tree

```
Is this a philosophical foundation?
├── YES → Foundational
└── NO
    ├── Is this a system specification?
    │   ├── YES → Architecture
    │   └── NO
    │       ├── Is this a governance rule?
    │       │   ├── YES → Governance
    │       │   └── NO
    │       │       ├── Is this decision rationale?
    │       │       ├── YES → Argumentation
    │       │       └── NO → Domain
```

### Conflict Resolution

If a document fits multiple classes:

1. **Architecture vs Domain**: Architecture if applies to KDE system; Domain if domain-specific
2. **Architecture vs Argumentation**: Architecture if specification; Argumentation if decision
3. **Domain vs Argumentation**: Argumentation if documents a decision within domain

---

## Migration Mapping

### Foundational

| Current | New Location | Class |
|---------|-------------|-------|
| 001-what-is-knowledge.md | foundational/001-what-is-knowledge.md | FOUND |
| 002-what-is-evidence.md | foundational/002-what-is-evidence.md | FOUND |
| 003-what-is-ambiguity.md | foundational/003-what-is-ambiguity.md | FOUND |

### Architecture

| Current | New Location | Class |
|---------|-------------|-------|
| KDE-ARCH-001.md | architecture/KDE-ARCH-001.md | ARCH |
| KDE-ARCH-002.md | architecture/KDE-ARCH-002.md | ARCH |
| ... | ... | ... |
| KDE-ARCH-010.md | architecture/KDE-ARCH-010.md | ARCH |

### Domain

| Current | New Location | Class | Domain |
|---------|-------------|-------|--------|
| gis/*.md | domain/gis/*.md | DOMAIN | gis |
| typography/*.md | domain/typography/*.md | DOMAIN | typography |
| visualization/*.md | domain/visualization/*.md | DOMAIN | visualization |
| utility-sld/*.md | domain/utility-sld/*.md | DOMAIN | utility-sld |

### Special Cases

| Document | Classification | Rationale |
|----------|---------------|-----------|
| knowledge-summary.md files | REMOVE | Laboratory artifacts, not Knowledge |

---

## References

| Document | Relationship |
|----------|--------------|
| KDE-KNOWLEDGE-DOCUMENT-SPECIFICATION.md | Parent specification |
| LAB-021 | Repository assessment |
| LAB-024 | Arbitration verdict |

---

## Version History

| Version | Date | Changes | Authority |
|---------|------|---------|-----------|
| 1.0.0 | 2026-07-21 | Initial taxonomy | LAB-024 Verdict |

---

**Document Status**: APPROVED
**Authority**: LAB-024 Arbitration
**Compliance**: MANDATORY

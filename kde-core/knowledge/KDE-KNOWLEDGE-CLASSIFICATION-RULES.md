# KDE Knowledge Classification Rules

**Document ID**: KDE-KNOWLEDGE-CLASS-RULES-001
**Title**: Knowledge Classification Rules
**Version**: 1.0.0
**Status**: APPROVED
**Confidence**: MEDIUM-HIGH
**Class**: ARCHITECTURE
**Authority**: LAB-027 Adversarial Analysis
**Effective Date**: 2026-07-21

---

## Purpose

This document establishes explicit rules for classifying knowledge in the KDE Knowledge Repository. These rules resolve the ambiguity between Domain and Architecture classifications identified during LAB-027.

---

## Classification Dimensions

The KDE Knowledge Repository uses **two classification dimensions**:

| Dimension | Name | Description |
|-----------|------|-------------|
| Primary | Knowledge Type | The fundamental purpose of the knowledge |
| Secondary | Domain | The application area (optional) |

### Knowledge Type Values

| Type | Definition | Classification Rule |
|------|------------|---------------------|
| **Foundational** | Philosophical/epistemological | Answers "What is X?" |
| **Architecture** | System specifications | Describes KDE system design |
| **Domain** | Application guidance | Answers "How do I use X?" |

---

## Classification Rules

### Rule 1: Foundational Documents

**Classification**: Foundational
**Location**: `knowledge/foundational/`

**Rule**: A document is Foundational if it:
1. Defines or clarifies a concept (What is X?)
2. Establishes philosophical/epistemological basis
3. Applies universally across all KDE domains

**Examples**:
- `001-what-is-knowledge.md` — Defines what knowledge means
- `002-what-is-evidence.md` — Defines what evidence means
- `003-what-is-ambiguity.md` — Clarifies ambiguity handling

**Not Examples**:
- Implementation details (→ Domain)
- System specifications (→ Architecture)

---

### Rule 2: Architecture Documents

**Classification**: Architecture
**Location**: `knowledge/architecture/`

**Rule**: A document is Architecture if it:
1. Specifies system-level design or behavior
2. Applies across multiple domains
3. Describes how KDE components interact
4. Establishes standards for system implementation

**Examples**:
- `KDE-ARCH-001.md` through `KDE-ARCH-010.md` — System specifications
- `KDE-DESKTOP-*.md` — Desktop runtime architecture patterns
- System-wide design patterns

**Not Examples**:
- Domain-specific implementation guidance (→ Domain)
- Foundational philosophy (→ Foundational)

---

### Rule 3: Domain Documents

**Classification**: Domain
**Location**: `knowledge/domain/[domain-name]/`

**Rule**: A document is Domain if it:
1. Provides application-level guidance
2. Is specific to a single domain area
3. Answers "How do I implement X in [domain]?"
4. Contains domain-specific best practices, rules, patterns

**Examples**:
- `domain/gis/design-rules.md` — GIS design guidance
- `domain/typography/best-practices.md` — Typography practices
- `domain/visualization/colors.md` — Visualization color guidance

**Not Examples**:
- Cross-domain specifications (→ Architecture)
- Universal definitions (→ Foundational)

---

## Domain vs. Architecture Boundary Rules

### The Core Question

**"Is this knowledge system-wide or domain-specific?"**

| Question | Architecture | Domain |
|----------|-------------|--------|
| Does it apply to all domains? | ✅ Yes | ❌ No |
| Is it domain-specific? | ❌ No | ✅ Yes |
| Describes system design? | ✅ Yes | ❌ No |
| Guides implementation? | ⚠️ Partial | ✅ Yes |

### Decision Tree

```
Is the knowledge about KDE system design?
├── YES → Is it system-wide (multiple domains)?
│       ├── YES → Architecture
│       └── NO → Is it domain-specific?
│               ├── YES → Domain
│               └── NO → Foundational
└── NO → Is it philosophical?
        ├── YES → Foundational
        └── NO → Domain
```

### Ambiguous Cases

| Case | Classification | Rationale |
|------|---------------|-----------|
| "GIS architecture patterns" | Domain | GIS-specific architecture guidance |
| "Cross-domain data model" | Architecture | Applies to multiple domains |
| "What is a design pattern?" | Foundational | Universal concept definition |

---

## Directory Structure Rules

### Structure

```
knowledge/
├── foundational/           # Foundational documents only
├── architecture/          # Architecture documents only
│   ├── KDE-ARCH-*.md      # KDE system specs
│   ├── KDE-DESKTOP-*.md   # Desktop runtime specs
│   └── patterns/          # (future) System patterns
└── domain/                # Domain documents only
    ├── gis/
    ├── typography/
    ├── visualization/
    └── utility-sld/
```

### Rules

1. **No cross-dimension documents**: A document belongs to exactly one primary classification
2. **Domain subdirectories**: Each domain gets its own subdirectory under `domain/`
3. **Architecture is flat**: Architecture documents are not further subdivided by domain
4. **Foundational is flat**: Foundational documents are not subdivided

---

## Metadata Rules

### Required Metadata

```yaml
class: FOUND|ARCH|DOMAIN
```

### Optional Metadata

```yaml
domain: [domain-name]  # Required for DOMAIN class
```

### Consistency Requirement

The directory structure and `class` metadata **must agree**.

| Directory | Required class |
|----------|---------------|
| `foundational/` | FOUND |
| `architecture/` | ARCH |
| `domain/[name]/` | DOMAIN |

---

## Cross-Cutting Knowledge

### Definition

Cross-cutting knowledge applies to multiple domains or spans multiple classifications.

### Handling Rules

| Type | Rule | Example |
|------|------|---------|
| Cross-domain patterns | Architecture | "Data visualization patterns" → architecture/ |
| Domain-specific extensions | Domain | "GIS visualization" → domain/gis/ |
| Foundational with examples | Foundational (primary) | Foundational with domain examples |

### Example

**Knowledge**: "Color theory for visualization"

| Option | Classification | Rationale |
|--------|---------------|-----------|
| In architecture/ | Architecture | Color theory applies to multiple domains |
| In domain/visualization/ | Domain | Visualization-specific application |
| In domain/gis/ | Domain | GIS-specific application |

**Decision**: Depends on scope:
- General color theory → Architecture
- Visualization application → Domain/visualization
- GIS-specific application → Domain/gis

---

## Enforcement

### Validation Rules

1. **Metadata consistency**: `class` must match directory
2. **No cross-dimension documents**: Single classification per document
3. **Domain specificity**: DOMAIN documents must specify domain

### Validation Tool

A validation tool should check:
- [ ] Document class matches directory
- [ ] Domain documents have domain metadata
- [ ] No documents in wrong directory

---

## Migration Guide

### For Existing Documents

| Document | Current | Correct | Action |
|----------|---------|---------|--------|
| `architecture/KDE-ARCH-*.md` | ARCH | ARCH | No change |
| `domain/gis/*.md` | DOMAIN | DOMAIN | No change |
| Foundational documents | FOUND | FOUND | No change |

**No migration required** — current structure is correct per these rules.

---

## Exceptions

### When to Break These Rules

1. **Strong user evidence**: Users consistently navigate differently
2. **Scale problems**: Structure doesn't scale at current growth rate
3. **Unforeseen classification**: Document clearly doesn't fit rules

### Process for Exceptions

1. Document the exception
2. Propose rule change
3. Update these rules
4. Migrate affected documents

---

## Handling Ambiguous Concepts

*Added by LAB-028 Falsification Experiment*

### The "Both" Problem

Some concepts have both architectural and domain-specific aspects. Examples:
- **Networking**: Infrastructure (Architecture) + API design (Domain)
- **Database**: Storage engines (Architecture) + schema design (Domain)
- **Machine Learning**: Model architecture (Architecture) + application (Domain)

### Decision Rule for Ambiguous Concepts

When a concept has both aspects:

1. **Determine primary purpose**: Is the concept primarily infrastructure or application?

2. **Infrastructure** = Provides runtime environment, enables applications
   - Examples: Desktop Runtime, Operating System, Networking stack
   - Classification: Architecture

3. **Application** = Contains distinct techniques, has domain practitioners
   - Examples: GIS (cartography), Visualization (charts), ML (models)
   - Classification: Domain

4. **If still ambiguous**, apply the **Conservative Rule**:
   - Classify as Architecture if it provides foundational capabilities
   - Classify as Domain if it has specialized vocabulary/techniques

### Terminology Check

**Do NOT** classify based on terminology alone:
- "Runtime" → Architecture (infrastructure)
- "System" → Architecture (but verify)
- "GIS" → Domain (field with practitioners)

**Verify** classification by asking: Does this concept describe HOW the system works, or HOW to do something?

### Examples of Correct Classification

| Concept | Primary Aspect | Classification |
|---------|---------------|----------------|
| Desktop Runtime | Infrastructure | Architecture |
| Visualization | Techniques | Domain |
| GIS | Application field | Domain |
| Networking | Infrastructure | Architecture |
| Database | Infrastructure | Architecture |
| Microservices | Pattern | Architecture |
| Compiler | Tool | Domain |
| Machine Learning | Technology | Architecture |

### Examples of Incorrect Classification

| Concept | Mistake | Reason |
|---------|---------|--------|
| Database | Domain | Incorrect — database SYSTEMS are infrastructure |
| Visualization | Architecture | Incorrect — visualization TECHNIQUES are domain |
| Networking | Domain | Incorrect — networking INFRASTRUCTURE is architecture |

---

## References

| Document | Relationship |
|----------|--------------|
| KDE-KNOWLEDGE-DOCUMENT-SPECIFICATION.md | Metadata requirements |
| KDE-KNOWLEDGE-TAXONOMY.md | Document classification |
| LAB-027 | Adversarial analysis source |
| LAB-028 | Falsification experiment |

---

## Version History

| Version | Date | Changes | Authority |
|---------|------|---------|-----------|
| 1.0.0 | 2026-07-21 | Initial rules from LAB-027 | LAB-027 |
| 1.1.0 | 2026-07-21 | Added ambiguous concepts guidance | LAB-028 |

---

**Status**: APPROVED
**Authority**: LAB-027 Adversarial Analysis, LAB-028 Falsification
**Compliance**: MANDATORY for new documents

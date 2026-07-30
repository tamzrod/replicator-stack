# Investigation: Knowledge Object Model Definition

**Template Version**: 1.0.0

---

## Metadata

| Field | Value |
|-------|-------|
| ID | INV-005 |
| Title | Knowledge Object Model Definition |
| Status | IN_PROGRESS |
| Created | 2026-07-30 |
| Engine | Gamma (KDE-ENGINE-003) |
| Author | OpenHands AI Agent |
| Prerequisite | Required before INV-003 (Storage Format) |

---

## Objective

Define the fundamental data model for knowledge objects in the KDE methodology. This is a prerequisite for storage format selection.

**This investigation does NOT select a storage format. It defines WHAT is being stored.**

---

## Research Questions

### Primary Question

What is the atomic unit of knowledge in the KDE methodology?

### Sub-Questions

1. What attributes must every knowledge object have?
2. What optional attributes enhance knowledge value?
3. What is the relationship between evidence and conclusions?
4. How should provenance be tracked?
5. How should confidence levels be represented?
6. What versioning semantics are needed?
7. How do objects relate to each other?

---

## Evidence Collection

### Evidence 1: Existing KDE Artifacts Analysis

**Source**: kde-core repository analysis

| Artifact Type | Fields Observed |
|---------------|-----------------|
| Investigation (INV-001) | id, title, status, created, engine, author, question, hypothesis, plan, findings, conclusions |
| Experiment (LAB-001) | id, title, status, purpose, hypothesis, methodology, results, verification |
| Validation (VAL-001) | id, title, status, validator, investigation, experiment, verdict |
| FUSED Engine Spec | engine_id, version, codename, status, methodology, pipeline |

### Evidence 2: Academic Knowledge Representation

**Source**: Knowledge Representation literature

| Model | Key Elements |
|-------|--------------|
| RDF Triple | Subject, Predicate, Object |
| Frame | Slot-filler structure |
| Conceptual Graph | Actors, entities, relations |
| SKOS | Concept, broader, narrower, related |

### Evidence 3: AI Engineering Patterns

**Source**: LangChain, AutoGPT, MemGPT artifact structures

| Pattern | Elements |
|---------|----------|
| Memory | content, embedding, timestamp |
| Tool | name, description, parameters, output |
| Task | id, status, result, dependencies |
| Message | role, content, metadata |

---

## Analysis

### Option 1: Atomic Triple Model

```json
{
  "type": "triple",
  "subject": "INV-001",
  "predicate": "concludes",
  "object": "replicator-stack is IIoT control plane"
}
```

**Pros**:
- Maximum flexibility
- Native RDF compatibility
- Easy deduplication

**Cons**:
- High granularity
- Query complexity
- Storage overhead

### Option 2: Document Model

```json
{
  "id": "INV-001",
  "type": "investigation",
  "title": "Repository Audit",
  "status": "complete",
  "content": { ... },
  "provenance": { ... },
  "confidence": 0.95
}
```

**Pros**:
- Self-contained
- Easy to render
- Natural boundary

**Cons**:
- Hard to merge
- Duplication risk
- Relationship implicit

### Option 3: Hybrid Model (RECOMMENDED)

```json
{
  "id": "KNOW-001",
  "type": "knowledge_object",
  "category": "assertion|evidence|hypothesis|conclusion",
  "content": {
    "statement": "...",
    "context": "...",
    "conditions": "..."
  },
  "provenance": {
    "source": "INV-001",
    "derived_from": ["EV-001", "EV-002"],
    "author": "agent_id",
    "created": "2026-07-30"
  },
  "confidence": {
    "value": 0.85,
    "basis": "statistical|inferred|expert",
    "factors": [...]
  },
  "relationships": {
    "supports": ["KNOW-002"],
    "contradicts": [],
    "related": ["KNOW-003"]
  },
  "lifecycle": {
    "status": "draft|candidate|validated|superseded",
    "version": "1.0",
    "supersedes": null
  }
}
```

---

## Knowledge Object Schema

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier (KNOW-XXX) |
| type | enum | assertion, evidence, hypothesis, conclusion, rule, pattern |
| category | enum | investigation, experiment, validation, synthesis |
| content | object | The knowledge itself |
| provenance | object | Source tracking |
| confidence | object | Confidence assessment |
| lifecycle | object | Version and status |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| relationships | object | Links to other objects |
| annotations | array | Human notes |
| tags | array | Categorization |
| embedding | array | Vector representation |
| attachments | array | External references |

### Content Structure

```yaml
content:
  statement:    # Required - the core claim
  context:      # Optional - when applies
  conditions:   # Optional - prerequisites
  exceptions:   # Optional - edge cases
  examples:     # Optional - illustrations
```

### Provenance Structure

```yaml
provenance:
  source_id:    # Original investigation/experiment
  derived_from: # List of source objects
  author:       # Agent or human
  created:      # ISO timestamp
  modified:     # ISO timestamp
  method:       # How derived
```

### Confidence Structure

```yaml
confidence:
  value:        # 0.0 - 1.0
  basis:        # statistical, inferred, expert, heuristic
  factors:      # Contributing factors
  limitations:  # Known bounds
```

### Relationship Types

| Type | Description | Cardinality |
|------|-------------|-------------|
| supports | Evidence for another object | N:M |
| contradicts | Opposing claim | N:M |
| derived_from | Parent object | N:1 |
| refined_by | More specific version | N:1 |
| supersedes | Replaces older object | N:1 |
| related | General association | N:M |

---

## Conclusions

### Primary Conclusion

**The Knowledge Object Model should be a Hybrid approach:**

1. **Self-contained documents** for natural boundaries (INV, LAB, VAL)
2. **Relationship triples** for explicit connections
3. **Provenance chain** for traceability
4. **Confidence scoring** for quality tracking
5. **Lifecycle status** for maturity management

### Atomic vs Composite Decision

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| Atomic unit | Knowledge Object | Not triple - too granular |
| Composite unit | Investigation/Experiment | Natural workflow boundary |
| Relationship model | Explicit triples | Enables graph queries |

### Implications for Storage Format

| Requirement | Implication |
|-------------|-------------|
| Document + triples | JSON-LD, RDF, or hybrid |
| Provenance | Must track lineage |
| Confidence | Numeric + basis fields |
| Relationships | Graph-capable storage |
| Versioning | Immutable objects with supersedes |

---

## Next Steps

- [x] Define Knowledge Object Model
- [ ] Proceed to INV-006: Ontology Design
- [ ] Proceed to INV-007: Query Requirements
- [ ] Use model for INV-008: Hybrid Prototype

---

## Evidence

```
[EVIDENCE: kde-core/laboratory/investigations/INV-001/ - Existing structure]
[EVIDENCE: kde-core/fused/engines/alpha/specification.fused - Engine spec pattern]
[EVIDENCE: W3C RDF 1.1 - Triple model]
[EVIDENCE: SKOS Simple Knowledge Organization System - Concept relationships]
```

---

## Related Artifacts

- Investigation: INV-005 (this file)
- Prerequisite: INV-004 (Independent Review)
- Depends on: INV-003 (Storage Format - pending model first)
- Enables: INV-006, INV-007, INV-008

# Investigation: Knowledge Ontology Design

**Template Version**: 1.0.0

---

## Metadata

| Field | Value |
|-------|-------|
| ID | INV-006 |
| Title | Knowledge Ontology Design |
| Status | IN_PROGRESS |
| Created | 2026-07-30 |
| Engine | Gamma (KDE-ENGINE-003) |
| Author | OpenHands AI Agent |
| Prerequisite | INV-005 (Knowledge Object Model) |

---

## Objective

Design the ontology (vocabulary and relationships) for the KDE knowledge system. This defines the semantics of knowledge objects.

---

## Research Questions

### Primary Question

What vocabulary and relationship types are needed for KDE knowledge representation?

### Sub-Questions

1. What classes (types) of knowledge objects are needed?
2. What properties (attributes) are required vs optional?
3. What relationship types connect objects?
4. What constraints apply to relationships?
5. Should we reuse existing ontologies (SKOS, Dublin Core, PROV-O)?
6. What inference rules are needed?
7. How does ontology evolve over time?

---

## Evidence Collection

### Evidence 1: Existing KDE Vocabulary

**Source**: kde-core repository

| Term | Usage |
|------|-------|
| investigation | Research phase (INV-XXX) |
| experiment | Testing phase (LAB-XXX) |
| validation | Verification phase (VAL-XXX) |
| evidence | Supporting facts |
| conclusion | Derived knowledge |
| hypothesis | Proposed explanation |
| rule | Constraining principle |
| engine | Execution engine (Alpha, Beta, Gamma, Delta) |
| seed | Foundational principle (SEED-001) |

### Evidence 2: Standard Ontology Reuse

**Source**: W3C and Semantic Web standards

| Ontology | Purpose | Reuse Value |
|----------|---------|-------------|
| RDF Schema | Basic classes and properties | HIGH |
| OWL | Complex constraints | MEDIUM |
| SKOS | Concept organization | HIGH |
| Dublin Core | Metadata | HIGH |
| PROV-O | Provenance | HIGH |
| FOAF | Agent identification | MEDIUM |
| SIOC | Online communities | LOW |

### Evidence 3: KDE-Specific Concepts

**Source**: kde-core fused-runtime

| Concept | Definition | Related |
|---------|------------|---------|
| SEED-001 | Five Core Principles | governance |
| Engine | Execution methodology | experiments |
| Laboratory | Scientific learning loop | investigations |
| Governance | Rules and constraints | principles |
| Checkpoint | Human authorization | workflow |

---

## Proposed Ontology

### Core Classes

```turtle
# Classes
:KnowledgeObject a rdfs:Class ;
    rdfs:label "Knowledge Object" ;
    rdfs:comment "Atomic unit of KDE knowledge" .

:Investigation a rdfs:Class ;
    rdfs:subClassOf :KnowledgeObject ;
    rdfs:label "Investigation" ;
    skos:definition "Research phase - defines questions and gathers evidence" .

:Experiment a rdfs:Class ;
    rdfs:subClassOf :KnowledgeObject ;
    rdfs:label "Experiment" ;
    skos:definition "Testing phase - validates hypothesis" .

:Validation a rdfs:Class ;
    rdfs:subClassOf :KnowledgeObject ;
    rdfs:label "Validation" ;
    skos:definition "Verification phase - confirms reproducibility" .

:Evidence a rdfs:Class ;
    rdfs:subClassOf :KnowledgeObject ;
    rdfs:label "Evidence" ;
    skos:definition "Supporting fact or observation" .

:Conclusion a rdfs:Class ;
    rdfs:subClassOf :KnowledgeObject ;
    rdfs:label "Conclusion" ;
    skos:definition "Derived knowledge from analysis" .

:Rule a rdfs:Class ;
    rdfs:subClassOf :KnowledgeObject ;
    rdfs:label "Rule" ;
    skos:definition "Constraining principle" .
```

### KDE-Specific Classes

```turtle
# KDE Engine Classes
:KDEEngine a rdfs:Class ;
    rdfs:label "KDE Engine" .

:AlphaEngine a rdfs:Class ;
    rdfs:subClassOf :KDEEngine ;
    rdfs:label "Alpha Engine (KDE-001)" .

:BetaEngine a rdfs:Class ;
    rdfs:subClassOf :KDEEngine ;
    rdfs:label "Beta Engine (KDE-002)" .

:GammaEngine a rdfs:Class ;
    rdfs:subClassOf :KDEEngine ;
    rdfs:label "Gamma Engine (KDE-003)" .

:DeltaEngine a rdfs:Class ;
    rdfs:subClassOf :KDEEngine ;
    rdfs:label "Delta Engine (KDE-004)" .

# KDE Process Classes
:Seed a rdfs:Class ;
    rdfs:label "Foundational Seed" .

:SEED001 a :Seed ;
    rdfs:label "Genesis (Five Core Principles)" .

:Checkpoint a rdfs:Class ;
    rdfs:label "Human Authorization Point" .

:Violation a rdfs:Class ;
    rdfs:label "Rule Violation" .
```

### Properties

```turtle
# Core Properties
:kdeId a rdf:Property ;
    rdfs:domain :KnowledgeObject ;
    rdfs:range xsd:string ;
    rdfs:label "KDE Identifier" .

:status a rdf:Property ;
    rdfs:domain :KnowledgeObject ;
    rdfs:range :LifecycleStatus ;
    rdfs:label "Lifecycle Status" .

:confidence a rdf:Property ;
    rdfs:domain :KnowledgeObject ;
    rdfs:range xsd:decimal ;
    rdfs:label "Confidence Level" .

:created a rdf:Property ;
    rdfs:domain :KnowledgeObject ;
    rdfs:range xsd:dateTime ;
    rdfs:label "Creation Timestamp" .

# Relationship Properties
:derivesFrom a rdf:Property ;
    rdfs:domain :KnowledgeObject ;
    rdfs:range :KnowledgeObject ;
    rdfs:label "Derived From" .

:supports a rdf:Property ;
    rdfs:domain :KnowledgeObject ;
    rdfs:range :KnowledgeObject ;
    rdfs:label "Supports" .

:contradicts a rdf:Property ;
    rdfs:domain :KnowledgeObject ;
    rdfs:range :KnowledgeObject ;
    rdfs:label "Contradicts" .

:refines a rdf:Property ;
    rdfs:domain :KnowledgeObject ;
    rdfs:range :KnowledgeObject ;
    rdfs:label "Refines" .

:supersedes a rdf:Property ;
    rdfs:domain :KnowledgeObject ;
    rdfs:range :KnowledgeObject ;
    rdfs:label "Supersedes" .

:partOf a rdf:Property ;
    rdfs:domain :KnowledgeObject ;
    rdfs:range :KnowledgeObject ;
    rdfs:label "Part Of" .

# Workflow Properties
:usesEngine a rdf:Property ;
    rdfs:domain :KnowledgeObject ;
    rdfs:range :KDEEngine ;
    rdfs:label "Uses Engine" .

:authorizes a rdf:Property ;
    rdfs:domain :Checkpoint ;
    rdfs:range :KnowledgeObject ;
    rdfs:label "Authorizes" .

:violates a rdf:Property ;
    rdfs:domain :Violation ;
    rdfs:range :Rule ;
    rdfs:label "Violates" .
```

### Constraints (OWL)

```turtle
# Constraints
[] a owl:Restriction ;
    owl:onProperty :derivesFrom ;
    owl:maxCardinality 1 ;
    rdfs:comment "Knowledge derives from at most one source" .

[] a owl:Restriction ;
    owl:onProperty :supersedes ;
    owl:maxCardinality 1 ;
    rdfs:comment "Can supersede at most one object" .

[] a owl:Restriction ;
    owl:onProperty :confidence ;
    owl:minCardinality 1 ;
    rdfs:comment "Every object must have confidence" .

[] a owl:Restriction ;
    owl:onProperty :confidence ;
    owl:withRestrictions xsd:decimal [ xsd:minInclusive 0.0 ; xsd:maxInclusive 1.0 ] ;
    rdfs:comment "Confidence must be 0.0 to 1.0" .
```

---

## Ontology Modules

### Module 1: Core (Required)

- KnowledgeObject class
- Basic properties (id, status, confidence, created)
- Derivation relationships

### Module 2: Workflow (Required)

- Investigation, Experiment, Validation classes
- Workflow properties
- Engine relationships

### Module 3: Governance (Optional)

- Seed class
- Rule class
- Checkpoint class
- Violation class

### Module 4: Evidence (Required)

- Evidence class
- Conclusion class
- Support/contradict relationships

---

## Reuse Recommendations

| Ontology | Use | KDE Mapping |
|----------|-----|------------|
| RDF Schema | Core classes | Use directly |
| SKOS | Concept organization | Use for vocabulary |
| Dublin Core | Metadata | Use for document metadata |
| PROV-O | Provenance | Use for derivation |
| OWL | Constraints | Use for validation |

---

## Ontology Evolution

### Versioning Strategy

```yaml
ontology_version: "1.0"
namespace: "https://kde.example.org/ontology/v1/"
deprecation_policy:
  sunset_period: "1 year"
  migration_support: true
  backwards_compatible_additions: true
  breaking_changes_require_version_bump: true
```

### Change Management

1. **Addition**: New classes/properties freely (backward compatible)
2. **Deprecation**: Mark obsolete, maintain support
3. **Modification**: Create new version, maintain old
4. **Removal**: After sunset period only

---

## Conclusions

### Primary Conclusion

**KDE Ontology should be RDF Schema + SKOS + PROV-O based:**

1. **Core vocabulary** from RDF Schema
2. **Classification** from SKOS
3. **Provenance** from PROV-O
4. **KDE-specific** extensions for engines, seeds, checkpoints

### Implications for Storage

| Requirement | Implication |
|-------------|-------------|
| RDF-based ontology | JSON-LD or Turtle storage |
| Inference support | OWL reasoner or inference layer |
| Namespace management | URI strategy needed |
| Vocabulary import | Standardized import mechanism |

---

## Next Steps

- [x] Design Ontology
- [ ] Proceed to INV-007: Query Requirements
- [ ] Use ontology for INV-008: Hybrid Prototype

---

## Evidence

```
[EVIDENCE: W3C RDF Schema - Class and property definitions]
[EVIDENCE: SKOS Simple Knowledge Organization System - Concept relationships]
[EVIDENCE: W3C PROV-O - Provenance ontology]
[EVIDENCE: kde-core/fused-runtime/seeds/ - Seed definitions]
[EVIDENCE: kde-core/fused/engines/ - Engine specifications]
```

---

## Related Artifacts

- Investigation: INV-006 (this file)
- Depends on: INV-005 (Knowledge Object Model)
- Enables: INV-007 (Query Requirements), INV-008 (Hybrid Prototype)

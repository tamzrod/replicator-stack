# Investigation: Knowledge Storage Format Evaluation for AI-Assisted Engineering

**Template Version**: 1.0.0

---

## Metadata

| Field | Value |
|-------|-------|
| ID | INV-003 |
| Title | Knowledge Storage Format Investigation |
| Status | IN_PROGRESS |
| Created | 2026-07-30 |
| Engine | Gamma (KDE-ENGINE-003) - Causal Discovery |
| Author | OpenHands AI Agent |

---

## Objective

Investigate and evaluate knowledge storage formats suitable for AI-assisted engineering knowledge repositories.

The objective is to identify or design a storage format that optimizes engineering knowledge collection, synthesis, querying, pattern discovery, and long-term maintainability.

**The investigation must remain evidence-driven. FUSED is one candidate among many and must be evaluated using the same criteria as existing formats.**

---

## Research Questions

### Primary Question

**Which knowledge storage format best supports the KDE methodology for AI-assisted engineering knowledge management?**

### Sub-Questions

1. What storage formats currently exist for structured knowledge?
2. Which formats are optimized for human readability?
3. Which formats are optimized for machine parsing?
4. Which formats best support AI reasoning?
5. Which formats best support incremental knowledge synthesis?
6. Which formats best preserve semantic structure?
7. Which formats best support relationship discovery?
8. Which formats are easiest to merge without conflicts?
9. Which formats enable efficient querying without requiring expensive preprocessing?
10. Does FUSED provide measurable advantages compared to existing approaches?

---

## Hypothesis

**H1**: Compact, structured formats (ProtoBuf, FUSED, TOML) will outperform verbose formats for AI token efficiency.

**H2**: FUSED's pipe-delimited syntax offers ~10-30% token savings over JSON but lacks tooling ecosystem.

**H3**: Formats with native relationship support (RDF, JSON-LD) enable faster querying without preprocessing overhead.

---

## Investigation Plan

### Phase 1: Format Survey

1. Document all candidate formats with specifications
2. Identify format categories (markup, data serialization, graph-based)
3. Gather official documentation for each format

### Phase 2: Evaluation Matrix Development

1. Define evaluation criteria across Human, AI, and Engineering factors
2. Define Pattern Detection criteria
3. Define Knowledge Synthesis criteria
4. Define Parsing criteria
5. Define Query criteria

### Phase 3: Evidence Collection

1. Evaluate each format against criteria
2. Collect evidence from official specifications
3. Document strengths and weaknesses
4. Identify gaps in format capabilities

### Phase 4: FUSED Evaluation

1. Analyze FUSED reference implementation in kde-core
2. Evaluate using same criteria as other formats
3. Document strengths, weaknesses, tradeoffs

### Phase 5: Synthesis

1. Compare formats using evidence matrix
2. Identify best-in-class for each criterion
3. Recommend format(s) for KDE methodology

---

## Candidate Formats to Investigate

| Category | Formats |
|----------|---------|
| Markup | Markdown, reStructuredText, AsciiDoc, Org Mode |
| Data Serialization | JSON, YAML, TOML, XML, INI, CSV |
| Semantic Web | RDF, Turtle, JSON-LD |
| Graph | Knowledge Graphs, GraphML |
| Structured Storage | SQLite, Protocol Buffers |
| Plain Text | Conventions-based approaches |
| Hybrid | FUSED (reference in kde-core) |

---

## Evaluation Criteria Framework (AI-First)

> **Note**: Format is for AI parsing. Human readability is irrelevant - if humans need it, just parse it.

### AI Parsing Factors

| Criterion | Description | Priority |
|-----------|-------------|----------|
| Parser availability | Ready-made parsers | HIGH |
| Parser complexity | Lines of code to parse | HIGH |
| Token efficiency | Tokens per data unit | HIGH |
| Memory footprint | RAM during parsing | HIGH |
| Streaming support | Can parse incrementally | MEDIUM |

### Query Factors

| Criterion | Description | Priority |
|-----------|-------------|----------|
| Direct access | Can query without full parse | HIGH |
| Index potential | Can build indexes efficiently | HIGH |
| Join complexity | How complex to join related data | HIGH |
| Graph traversal | Native support for relationships | MEDIUM |

### Analysis Factors

| Criterion | Description | Priority |
|-----------|-------------|----------|
| Pattern detection | How fast to find patterns | HIGH |
| Schema inference | Can infer structure automatically | MEDIUM |
| Type preservation | Types survive parsing | HIGH |
| Null handling | How missing values represented | MEDIUM |

### Token Efficiency Measurement

For equivalent data:
- Count tokens/bytes per record
- Count tokens/bytes per relationship
- Count tokens/bytes per query result

---

## Pattern Detection Evaluation

For each format, evaluate:

- Relationship extraction capability
- Hierarchy detection
- Cross-reference discovery
- Duplicate detection
- Contradiction detection
- Similarity clustering
- Knowledge graph generation
- Temporal evolution analysis

---

## Knowledge Synthesis Evaluation

For each format, evaluate:

- Combining multiple investigations
- Knowledge deduplication
- Promotion from evidence to validated knowledge
- Maintaining provenance
- Maintaining confidence levels
- Tracking superseded knowledge
- Incremental refinement

---

## Parsing Evaluation

For each format, evaluate:

- Parser availability
- Parser complexity
- Error tolerance
- Streaming support
- Partial loading
- Incremental parsing
- Deterministic parsing

---

## Query Evaluation

Example queries to evaluate:

- Find all experiments supporting a rule
- Find all knowledge derived from a specific investigation
- Find all contradictory evidence
- Find all obsolete knowledge
- Find all objects related to Engine Alpha
- Traverse dependency chains
- Discover hidden relationships

Query complexity types:

- Simple traversal
- Database indexing
- Graph traversal
- Vector search
- Full document scanning

---

## FUSED Evaluation (Reference)

Use FUSED examples from kde-core repository:

- `fused/engines/alpha/*.fused`
- `fused/engines/beta/*.fused`
- `fused/engines/gamma/*.fused`
- `fused/engines/delta/*.fused`

Evaluate using same criteria as all other formats.

---

## Evidence Collection

Document evidence as it is collected:

```
[EVIDENCE: Format specification source]
[EVIDENCE: Performance benchmark source]
[EVIDENCE: Use case documentation]
[EVIDENCE: Community adoption data]
```

---

## Deliverables

1. **Survey of existing storage formats** - Comprehensive format documentation
2. **Comparative evaluation matrix** - All formats scored against criteria
3. **Evidence supporting each score** - Citations and observations
4. **Identification of strengths and weaknesses** - Per format
5. **Gap analysis** - What no format does well
6. **Recommendation** - Which format(s) to adopt
7. **FUSED disposition** - Adopt, modify, or reject
8. **Proposed future experiments** - LAB artifacts for validation

---

## Success Criteria

The investigation is successful if it produces sufficient evidence to justify the selection or evolution of a knowledge storage format suitable for the KDE methodology.

**The conclusion must be evidence-based and reproducible. Personal preference, familiarity, or implementation convenience are not sufficient justification.**

---

## Next Steps

- [x] Define investigation question
- [ ] Conduct format survey
- [ ] Develop evaluation matrix
- [ ] Collect evidence for each format
- [ ] Evaluate FUSED using same criteria
- [ ] Synthesize findings
- [ ] Proceed to Experiment phase (LAB-003)

---

## Related Artifacts

- Investigation: INV-003 (this file)
- Experiments: LAB-003 (pending)
- Evidence: evidence/ folder
- FUSED Reference: fused/engines/*/changes.fused

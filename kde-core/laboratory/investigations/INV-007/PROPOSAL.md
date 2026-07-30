# Investigation: Query Requirements Definition

**Template Version**: 1.0.0

---

## Metadata

| Field | Value |
|-------|-------|
| ID | INV-007 |
| Title | Query Requirements Definition |
| Status | IN_PROGRESS |
| Created | 2026-07-30 |
| Engine | Gamma (KDE-ENGINE-003) |
| Author | OpenHands AI Agent |
| Prerequisite | INV-005, INV-006 (Model + Ontology) |

---

## Objective

Define query requirements for the KDE knowledge system. This determines what queries must be supported and at what performance level.

---

## Research Questions

### Primary Question

What queries does the KDE methodology require, and what performance is needed?

### Sub-Questions

1. What query patterns are needed?
2. What is acceptable latency for each pattern?
3. Should queries be synchronous or asynchronous?
4. What indexing strategies are required?
5. Should queries support full-text search?
6. What about graph traversal queries?
7. How should complex queries be composed?

---

## Evidence Collection

### Evidence 1: KDE Workflow Query Needs

**Source**: kde-core laboratory workflow

| Query Pattern | Example | Frequency |
|---------------|---------|-----------|
| Find object by ID | Get INV-001 | HIGH |
| Find objects by type | All investigations | HIGH |
| Find evidence for conclusion | Supporting KNOW-XXX | MEDIUM |
| Find contradictions | Related to KNOW-XXX | LOW |
| Find objects by author | Created by agent X | MEDIUM |
| Find objects by date | Created after Y | MEDIUM |
| Find by confidence | Confidence > 0.9 | LOW |
| Find deprecated | Status = superseded | LOW |
| Find unresolved | Status = draft | MEDIUM |
| Find by relationship | Part of INV-001 | MEDIUM |

### Evidence 2: Query Performance Requirements

**Source**: Engineering standards

| Use Case | Latency Requirement | Throughput |
|----------|---------------------|------------|
| Real-time AI reasoning | < 100ms | 1000/sec |
| Background synthesis | < 10s | 10/sec |
| Interactive browsing | < 1s | 100/sec |
| Batch analysis | < 60s | 1/sec |
| Graph traversal | < 5s | 100/sec |

### Evidence 3: Query Pattern Taxonomy

**Source**: Database literature

| Pattern Type | Characteristics |
|--------------|----------------|
| Point query | By ID, exact match |
| Range query | By date, confidence, version |
| Pattern match | By status, type |
| Text search | Full-text, partial |
| Graph traversal | Multi-hop relationships |
| Aggregation | Count, sum, average |
| Path query | Between two nodes |

---

## Query Requirements

### Critical Queries (Must Support)

#### Q1: Get Object by ID

```yaml
query: "Get object by kdeId"
input: "KNOW-001"
output: "Full object"
latency: "< 10ms"
frequency: "HIGH"
```

#### Q2: List Objects by Type

```yaml
query: "List all objects of type X"
input: "investigation"
output: "Array of objects"
latency: "< 100ms (1000 objects)"
frequency: "HIGH"
```

#### Q3: Find Supporting Evidence

```yaml
query: "Find evidence that supports object X"
input: "KNOW-001"
output: "Array of Evidence objects"
relationship: "derivesFrom, supports"
latency: "< 100ms"
frequency: "MEDIUM"
```

#### Q4: Find Contradictions

```yaml
query: "Find objects that contradict X"
input: "KNOW-001"
output: "Array of objects"
relationship: "contradicts"
latency: "< 100ms"
frequency: "LOW"
```

### Important Queries (Should Support)

#### Q5: Temporal Queries

```yaml
query: "Find objects created after date X"
input: "2026-07-01"
output: "Array of objects"
latency: "< 500ms"
index: "created timestamp"
```

#### Q6: Confidence Filtering

```yaml
query: "Find objects with confidence > X"
input: "0.9"
output: "Array of objects"
latency: "< 500ms"
index: "confidence"
```

#### Q7: Text Search

```yaml
query: "Full-text search in content"
input: "Modbus protocol"
output: "Ranked results"
latency: "< 1s"
index: "full-text"
```

#### Q8: Provenance Trace

```yaml
query: "Trace derivation chain"
input: "KNOW-001"
output: "Tree of ancestors"
latency: "< 500ms"
traversal: "recursive"
```

### Nice-to-Have Queries

#### Q9: Pattern Detection

```yaml
query: "Find objects with pattern X in content"
input: "confidence > 0.9 AND type = evidence"
output: "Array of matching objects"
latency: "< 5s"
complexity: "HIGH"
```

#### Q10: Graph Analysis

```yaml
query: "Find all relationships between X and Y"
input: "INV-001, VAL-001"
output: "Path of relationships"
latency: "< 5s"
traversal: "bidirectional"
```

---

## Query Language Requirements

### Must Have

| Feature | Description | Example |
|---------|-------------|---------|
| ID lookup | Exact match on kdeId | `id = "KNOW-001"` |
| Type filter | By object type | `type = "investigation"` |
| Property filter | Any property | `confidence > 0.9` |
| Relationship | Traverse relationships | `derivesFrom.id = "EV-001"` |
| Logical AND | Combine conditions | `type = X AND confidence > Y` |
| Logical OR | Alternative conditions | `type = X OR type = Y` |
| Pagination | Limit and offset | `LIMIT 100 OFFSET 200` |

### Should Have

| Feature | Description | Example |
|---------|-------------|---------|
| Full-text search | Content matching | `CONTAINS(content, "Modbus")` |
| Regex | Pattern matching | `id MATCHES "INV-\d+"` |
| Aggregation | Count, sum | `COUNT(*) GROUP BY type` |
| Ordering | Sort results | `ORDER BY confidence DESC` |

### Nice to Have

| Feature | Description |
|---------|-------------|
| Inference | RDFS/OWL reasoning |
| Geo | Spatial queries |
| Time series | Temporal analysis |

---

## Query API Design

### Proposed API

```yaml
endpoint: "/api/v1/query"
methods:
  - POST  # Complex queries
  - GET   # Simple lookups
formats:
  request: "JSON"
  response: "JSON"
```

### Query Request Format

```json
{
  "query": {
    "type": "find",
    "conditions": [
      { "field": "type", "op": "=", "value": "investigation" },
      { "field": "confidence.value", "op": ">", "value": 0.9 }
    ],
    "relationships": [
      { "path": "derivesFrom", "direction": "outbound" }
    ],
    "pagination": { "limit": 100, "offset": 0 },
    "order": { "field": "created", "direction": "desc" }
  }
}
```

### Query Response Format

```json
{
  "results": [
    {
      "id": "KNOW-001",
      "type": "investigation",
      "confidence": 0.95,
      "_score": 1.0,
      "_highlights": ["matches in content"]
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 100,
    "offset": 0,
    "has_more": true
  },
  "metadata": {
    "query_time_ms": 45,
    "engine": "default"
  }
}
```

---

## Storage Architecture Implications

### Query Support by Format

| Format | Point Query | Range Query | Graph Query | Full-Text |
|--------|-------------|-------------|-------------|-----------|
| JSON (flat) | O(n) | O(n) | N/A | O(n) |
| JSON + index | O(log n) | O(log n) | N/A | O(n) |
| RDF | O(1) | O(log n) | O(n) | O(n) |
| RDF + index | O(1) | O(log n) | O(log n) | O(log n) |
| Graph DB | O(1) | O(log n) | O(1) | O(n) |
| FUSED | O(n) | O(n) | N/A | O(n) |
| FUSED + custom | O(1) | O(log n) | O(n) | O(n) |

### Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Query API Layer                          │
├─────────────────────────────────────────────────────────────┤
│  SPARQL/GraphQL   │  Full-Text   │  Simple REST  │  Vector │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                    Storage Layer                              │
├──────────────┬──────────────┬──────────────┬─────────────────┤
│   Primary    │   Graph      │   Search     │   Vector        │
│   RDF Store  │   Index      │   Index      │   Index         │
│   (Blazegraph│   (LPG)      │   (Elastic)  │   (Pinecone)    │
└──────────────┴──────────────┴──────────────┴─────────────────┘
```

---

## Conclusions

### Primary Conclusion

**Query requirements demand a multi-model approach:**

1. **RDF/graph store** for relationship traversal
2. **Full-text index** for content search
3. **Simple lookups** via indexed fields
4. **FUSED cannot meet these requirements alone**

### Query Support Matrix

| Requirement | FUSED Only | FUSED + Index | RDF-based | Hybrid |
|-------------|------------|---------------|-----------|--------|
| Point query | ❌ O(n) | ✅ O(1) | ✅ O(1) | ✅ |
| Graph traversal | ❌ N/A | ❌ Custom | ✅ Native | ✅ |
| Full-text | ❌ N/A | ❌ Custom | ❌ Add-on | ✅ |
| Complex joins | ❌ N/A | ❌ Complex | ✅ SPARQL | ✅ |

### Recommendation

**Do NOT use FUSED as primary query store.** Use FUSED as authoring format with transformation to RDF/graph for queries.

---

## Next Steps

- [x] Define Query Requirements
- [ ] Proceed to INV-008: JSON-LD + FUSED Hybrid Prototype

---

## Evidence

```
[EVIDENCE: kde-core laboratory workflow - query patterns observed]
[EVIDENCE: W3C SPARQL 1.1 - Query language specification]
[EVIDENCE: Graph database performance studies - Neo4j, Amazon Neptune]
[EVIDENCE: Full-text search benchmarks - Elasticsearch, Solr]
```

---

## Related Artifacts

- Investigation: INV-007 (this file)
- Depends on: INV-005 (Model), INV-006 (Ontology)
- Enables: INV-008 (Hybrid Prototype)

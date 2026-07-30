# Investigation Template

**Template Version**: 2.0.0

---

## ⚠️ TRACE ENFORCEMENT REQUIRED

**ALL investigations must use the trace enforcement workflow.**

```python
from runtime.ecu.trace import TraceEnforcer

enforcer = TraceEnforcer()
enforcer.pre_investigation('INV-XXX', 'EngineName')

# ... investigation work ...

enforcer.post_investigation({'outcome': 'success'})
```

**Without TRACE-INIT, investigation will be REJECTED.**

---

## Metadata

| Field | Value |
|-------|-------|
| ID | INV-XXX |
| Title | Investigation Title |
| Status | DRAFT |
| Created | YYYY-MM-DD |
| Engine | Engine name |
| Author | Author name |
| Trace Required | ✅ YES |

---

## Trace Log

```
TRACE-INIT: Generated at start
TRACE-PHASE-1: [Method name]
TRACE-PHASE-2: [Method name]
TRACE-PHASE-3: [Method name]
TRACE-PHASE-4: [Method name]
TRACE-COMPLETE: Generated at end
```

---

## Question

What knowledge question is this investigation addressing?

---

## Hypothesis

State the hypothesis to be investigated.

---

## Investigation Plan

1. Step 1
2. Step 2
3. Step 3

---

## Trace Phases

### Phase 1: Evidence Analysis

```
TRACE-PHASE-1: analyzeevidence
  inputs: {evidence_count: N}
  outputs: {patterns_found: N}
```

### Phase 2: Knowledge Validation

```
TRACE-PHASE-2: validateknowledge
  inputs: {knowledge_id: KNOW-XXX}
  outputs: {valid: true/false}
```

### Phase 3: Knowledge Generation

```
TRACE-PHASE-3: generateknowledgepipeline
  inputs: {}
  outputs: {knowledge_count: N}
```

### Phase 4: Report Generation

```
TRACE-PHASE-4: generatereport
  inputs: {}
  outputs: {report_id: REPORT-XXX}
```

---

## Evidence Collection

Document evidence as it is collected:

```
[EVIDENCE: source citation]
[EVIDENCE: source citation]
```

---

## Findings

### Primary Findings

Document the main findings here.

### Supporting Evidence

Link to supporting evidence files.

---

## Conclusions

What conclusions can be drawn from this investigation?

---

## Trace Completion

```
TRACE-COMPLETE:
  phases_completed: 4
  outcome: success
  timestamp: YYYY-MM-DDTHH:MM:SSZ
```

---

## Related Artifacts

- Experiments: LAB-XXX
- Evidence: (evidence files)
- Trace: TRACE.md

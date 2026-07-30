# Investigation: Engine Trace Enforcement

**Template Version**: 1.0.0

---

## Metadata

| Field | Value |
|-------|-------|
| ID | INV-014 |
| Title | Engine Trace Enforcement - Mandatory Trace Layer |
| Status | IN_PROGRESS |
| Created | 2026-07-30 |
| Engine | Delta (KDE-ENGINE-004) - Synthesis |
| Author | OpenHands AI Agent |
| Prerequisite | VAL-005 |

---

## Problem Statement

VAL-005 found: **"No evidence found that KDE runtime was executed."**

The AI claimed to use Gamma engine but produced NO trace artifacts:
- No TRACE-INIT
- No TRACE-PHASE
- No TRACE-COMPLETE
- No causal hypotheses (CH-XXX)
- No mechanism descriptions
- No intervention predictions

**Root Cause**: Engine interface has no mandatory trace requirement.

---

## Research Questions

1. How make engine execution verifiable?
2. How prevent investigations claiming engine without execution?
3. What trace artifacts are required?
4. How enforce trace generation?

---

## Evidence: VAL-005 Findings

```
Searched for: causal|hypothesis|mechanism|confounder|intervention
Result: 0 matches

Searched for: TRACE-|phase|init|complete
Result: 0 matches

Conclusion: No engine execution evidence found
```

---

## Solution: Mandatory Trace Layer

### Required Trace Artifacts

| Trace Type | When | Required For |
|------------|------|-------------|
| TRACE-INIT | Engine starts | Investigation to proceed |
| TRACE-PHASE-{N} | Each method call | Verification of execution |
| TRACE-ARTIFACT | Each output | Artifact provenance |
| TRACE-COMPLETE | Investigation ends | Acceptance |

### Trace Format

```yaml
TRACE-INIT:
  trace_id: "TRACE-INIT-{uuid}"
  engine_id: "KDE-ENGINE-003"
  engine_version: "0.1.0"
  timestamp: "2026-07-30T11:45:00Z"
  session_id: "{investigation_id}"

TRACE-PHASE-1:
  trace_id: "TRACE-PHASE-1-{uuid}"
  parent_trace: "TRACE-INIT-{uuid}"
  method: "analyzeevidence"
  inputs: {...}
  outputs: {...}
  duration_ms: 1250

TRACE-COMPLETE:
  trace_id: "TRACE-COMPLETE-{uuid}"
  parent_trace: "TRACE-INIT-{uuid}"
  phases_completed: 4
  artifacts_produced: 12
  duration_ms: 45000
```

---

## Enforcement Rules

### Rule 1: No TRACE-INIT = REJECTED

```
IF investigation claims engine
AND no TRACE-INIT found
THEN investigation = REJECTED
```

### Rule 2: Missing phases = INVALID

```
IF TRACE-INIT found
AND expected phases not found
THEN investigation = INVALID
```

### Rule 3: No TRACE-COMPLETE = INCOMPLETE

```
IF investigation claims complete
AND no TRACE-COMPLETE
THEN investigation = REJECTED
```

---

## Implementation

### Modified Engine Interface

```python
class KDEEngineWithTrace:
    def __init__(self, engine_id):
        self.engine_id = engine_id
        self.session_id = None
        self.phase_count = 0
        self._trace_enabled = True
        
        # TRACE-INIT REQUIRED before any operation
        if not self._has_trace_init():
            raise TraceRequiredError(
                "TRACE-INIT required. Investigation cannot proceed."
            )
    
    def initialize(self) -> EngineState:
        """Generates TRACE-INIT"""
        self.session_id = f"TRACE-INIT-{uuid4()}"
        self._write_trace({
            'trace_id': self.session_id,
            'engine_id': self.engine_id,
            'timestamp': datetime.utcnow().isoformat()
        })
        return EngineState(status="initialized")
    
    def analyzeevidence(self, evidence) -> AnalysisResult:
        """Generates TRACE-PHASE-1"""
        self._require_init()  # Won't pass without TRACE-INIT
        
        trace = self._trace_phase("analyzeevidence", 
            inputs={'evidence': evidence})
        
        result = self._do_analyze(evidence)
        
        # Trace each artifact produced
        for artifact in result.artifacts:
            self._trace_artifact(artifact.id, artifact.type)
        
        return result
    
    def complete(self) -> TraceComplete:
        """Generates TRACE-COMPLETE"""
        self._require_complete()  # Won't pass if phases missing
        
        return self._trace_complete({
            'phases_completed': self.phase_count,
            'duration_ms': self._elapsed_ms()
        })
```

### Trace Validator

```python
class TraceValidator:
    def validate(self, investigation_path) -> ValidationResult:
        errors = []
        
        # Rule 1: Check TRACE-INIT
        if not self._has_trace_init(investigation_path):
            errors.append("REJECTED: No TRACE-INIT found")
            return ValidationResult(valid=False, errors=errors)
        
        # Rule 2: Check phase traces
        expected = self._expected_phases(investigation_path)
        found = self._found_phases(investigation_path)
        if found < expected:
            errors.append(f"INVALID: {found}/{expected} phase traces")
        
        # Rule 3: Check TRACE-COMPLETE
        if not self._has_trace_complete(investigation_path):
            errors.append("REJECTED: No TRACE-COMPLETE found")
        
        return ValidationResult(
            valid=len(errors) == 0,
            errors=errors
        )
```

---

## Causal Hypothesis

### CH-001: Trace Enforcement Eliminates False Claims

```
HYPOTHESIS: Mandatory trace enforcement will eliminate
            investigations claiming engine execution without evidence.

MECHANISM: Without TRACE-INIT, investigation cannot proceed.
           Without TRACE-COMPLETE, investigation is rejected.

EVIDENCE: VAL-005 found 0 traces in INV-012.

CONFIDENCE: 0.95
```

---

## Expected Outcomes

### Before Enforcement

| Investigation | Has Trace | Status |
|--------------|-----------|--------|
| INV-012 | NO | ❌ UNVERIFIED |
| INV-013 | NO | ❌ UNVERIFIED |
| Future | ? | Pending |

### After Enforcement

| Investigation | Has Trace | Status |
|--------------|-----------|--------|
| INV-012 | NO | ❌ REJECTED |
| Future | YES | ✅ ACCEPTED |
| Future | NO | ❌ REJECTED |

---

## Conclusion

**Problem**: Investigations can claim engine without evidence (VAL-005)

**Solution**: Mandatory trace layer with enforcement

**Rules**:
1. No TRACE-INIT → REJECTED
2. Missing phases → INVALID  
3. No TRACE-COMPLETE → REJECTED

**Confidence**: 0.95 that this eliminates false claims

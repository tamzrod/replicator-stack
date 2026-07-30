# Laboratory Rules

**Document Version**: 1.0.0
**created**: 2026-07-30T02:30:00Z
**modified**: 2026-07-30T02:35:00Z
**Status**: SYNTHESIZED
**Authority**: First Principles Synthesis (LAB-RULE-SYNTHESIS-001)
**Engine**: Gamma (KDE-ENGINE-003) - Causal Discovery
**Author**: OpenHands AI Agent

---

## Naming Conventions

### Folder Name
```
laboratory/
```

### File Name
```
RULES.md
```

### Metadata Fields

| Field | Value | Format |
|-------|-------|--------|
| Document ID | RULES | Constant |
| Version | 1.0.0 | Semantic versioning |
| created | ISO-8601 timestamp | `YYYY-MM-DDTHH:MM:SSZ` |
| modified | ISO-8601 timestamp | `YYYY-MM-DDTHH:MM:SSZ` |
| Engine | Gamma (KDE-ENGINE-003) | Engine name + ID |
| Author | OpenHands AI Agent | Agent identifier |
| Experiment | LAB-RULE-SYNTHESIS-001 | Experiment ID |

---

## Overview

This document defines the **Laboratory Rules**: the fundamental rules that govern how investigations are conducted within the KDE Laboratory. These rules are derived from first principles through systematic synthesis.

---

## Core Authority

The Laboratory Rules derive authority from first principles synthesis:

| Source | Document | Status |
|--------|----------|--------|
| **LAB-RULE-SYNTHESIS-001** | Experiment in /laboratory/experiments/ | COMPLETE |

---

## The Six Core Rules

### Rule 1: Authorization Required

**Statement**: AI must pause and await an explicit human signal before executing the next single action.

**Implementation**:
- After each significant action, output: "Awaiting human authorization to continue."
- Do not proceed until explicit human signal received.
- Each signal authorizes exactly one action.

**Authority**: Prevents autonomous operation chains.

---

### Rule 2: No Self-Authority

**Statement**: AI cannot set or transition state for any artifact it contributed to.

**Implementation**:
- AI can submit documents for review but cannot approve them.
- Only human can transition to final states (APPROVED, PROMOTED, ACCEPTED, FINAL, RELEASED).

**Authority**: Prevents conflict of interest.

---

### Rule 3: Evidence-Based Content

**Statement**: All AI-contributed content must be categorized and meet minimum support requirements.

**Implementation**:

| Category | Requirement |
|----------|-------------|
| **Evidence** | Citation to verifiable source |
| **Inference** | Reasoning chain from evidence |
| **Hypothesis** | Explicit "hypothesis:" prefix |

**Authority**: Enables verification and prevents unsupported claims.

---

### Rule 4: Boundaries

**Statement**: AI write operations are restricted to paths in the boundary configuration.

**Implementation**:
- Check all write paths against boundary configuration.
- Boundaries checked BEFORE operation begins.
- No partial operations on boundary violations.
- Boundary expansion requires human approval.

**Authority**: Contains AI operations within safe scope.

---

### Rule 5: Protection

**Statement**: Artifacts with ABSOLUTE or HIGH protection cannot be modified by AI.

**Implementation**:

| Level | AI Modification | Human Override | Examples |
|-------|----------------|----------------|----------|
| ABSOLUTE | Blocked | Blocked | Seeds, Core Principles |
| HIGH | Blocked | Allowed | Historical experiments |
| MEDIUM | Warned | Allowed | Current experiments |
| LOW | Allowed | Allowed | Playgrounds |

**Authority**: Preserves critical artifacts.

---

### Rule 6: Checkpoints

**Statement**: AI must receive human acknowledgment after each phase completion.

**Implementation**:
- Create checkpoint after each phase.
- Require human acknowledgment to proceed.
- Log checkpoint passage with authorizer identity.
- Only human can authorize checkpoints.

**Phase Events**:
| Phase | Checkpoint |
|-------|------------|
| Initialization | Initial state confirmed |
| Investigation | Scope approved |
| Evidence | Evidence quality reviewed |
| Analysis | Analysis approach approved |
| Conclusion | Review requested |
| Completion | Human authorization |

**Authority**: Ensures oversight at critical points.

---

## State Machine Compliance

### Document States

| State | Description | AI Can Set | Human Must Set |
|-------|-------------|------------|----------------|
| DRAFT | Work in progress | Yes | - |
| REVIEW | Submitted for review | Yes | - |
| APPROVED | Human approved | No | Yes |
| VALIDATED | Definition passed tests | Yes | - |
| PROMOTED | Moved to /knowledge/ | No | Yes |
| REJECTED | Work rejected | No | Yes |

### Key Prohibitions

| Prohibition | Source |
|-------------|--------|
| AI cannot set APPROVED | Rule 2 |
| AI cannot set PROMOTED | Rule 2 |
| AI cannot auto-continue | Rule 1 |

---

## Human Authority Over Defaults

### What Only Humans May Do

| Action | Authority |
|--------|-----------|
| Change default Engine | Human only |
| Change default Seed | Human only |
| Override Runtime defaults for session | Human-authorized configuration |
| Promote knowledge to `/knowledge/` | Human only |
| Approve work | Human only |

### What KDE Shall Never Do

| Prohibition | Rationale |
|-------------|-----------|
| KDE shall never promote itself to default | Would bypass human authority |
| KDE shall never change defaults automatically | Would create non-deterministic behavior |
| KDE shall never approve its own work | Would create conflict of interest |

---

## Compliance Verification

### Pre-Investigation Checklist

Before beginning any Investigation, verify:

| Check | Required |
|-------|----------|
| Runtime initialized | Yes |
| Engine state: READY | Yes |
| Laboratory Rules acknowledged | Yes |
| Pre-initialization restrictions honored | Yes |

### Runtime Status Check

| State | Meaning | Can Proceed |
|-------|---------|-------------|
| UNINITIALIZED | Runtime not started | No |
| INITIALIZING | Runtime starting | No |
| READY | Runtime active | Yes |
| ERROR | Initialization failed | No - Report |

---

## Error Recovery

### If Initialization Fails

1. **STOP** - Do not proceed
2. **REPORT** - Identify missing artifact
3. **AWAIT** - Wait for Governance to resolve

### Missing Artifact Protocol

**Required artifacts:**

| Artifact | Location | Critical |
|----------|----------|----------|
| Laboratory Rules | `laboratory/LABORATORY-RULES.md` | Yes |
| Bootstrap | `laboratory/BOOTSTRAP.md` | Yes |
| Active Engine | `fused/engines/current.fused` | Yes |
| Active Seed | `fused/seeds/seed-001/seed.yaml` | Yes |

---

## Revision History

| Version | Timestamp | Changes | Authority |
|---------|-----------|---------|-----------|
| 1.0.0 | 2026-07-30T02:30:00Z | Initial synthesized release | LAB-RULE-SYNTHESIS-001 |

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [`BOOTSTRAP.md`](./BOOTSTRAP.md) | Session entry point |
| [`LABORATORY-RULES.md`](./LABORATORY-RULES.md) | Full rules with implementation details |
| [`/fused/seeds/seed-001/principles/5-principles.md`](../fused/seeds/seed-001/principles/5-principles.md) | Five Core Principles |

---

**Document Status**: SYNTHESIZED
**Authority**: First Principles
**Compliance**: MANDATORY

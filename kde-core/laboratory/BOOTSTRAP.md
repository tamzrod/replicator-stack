# KDE Bootstrap

**Document Version**: 1.0.0
**created**: 2026-07-30T02:30:00Z
**modified**: 2026-07-30T02:35:00Z
**Status**: PRODUCTION
**Purpose**: Canonical entry point for all KDE sessions
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
BOOTSTRAP.md
```

### Metadata Fields

| Field | Value | Format |
|-------|-------|--------|
| created | ISO-8601 timestamp | `YYYY-MM-DDTHH:MM:SSZ` |
| modified | ISO-8601 timestamp | `YYYY-MM-DDTHH:MM:SSZ` |
| Engine | Gamma (KDE-ENGINE-003) | Engine name + ID |
| Author | OpenHands AI Agent | Agent identifier |
| Status | PRODUCTION | Document status |

---

## Purpose

This document is the **canonical entry point** for every fresh KDE session. It is the first artifact an AI agent shall read upon initializing a new KDE workflow.

**This artifact does NOT contain the Runtime implementation.** Its sole purpose is to transfer execution authority to the KDE Runtime before any other work begins.

---

## Entry Point Declaration

```
┌─────────────────────────────────────────────────────────────┐
│                    KDE ENTRY POINT                          │
│                                                             │
│  You have reached the KDE Knowledge Discovery Engine.        │
│                                                             │
│  STOP: Do NOT begin planning, exploring, or analyzing.      │
│                                                             │
│  Read this document completely before proceeding.           │
└─────────────────────────────────────────────────────────────┘
```

---

## Initialization Protocol

### Step 1: Acknowledge Laboratory Rules

Before performing ANY work, you must acknowledge the **Laboratory Rules** defined in [`LABORATORY-RULES.md`](./LABORATORY-RULES.md).

The Laboratory Rules are:

| Rule | Description |
|------|-------------|
| **1. Authorization Required** | AI must await human signal before next action |
| **2. No Self-Authority** | AI cannot approve/promote its own work |
| **3. Evidence-Based Content** | AI must categorize evidence/inference/hypothesis |
| **4. Boundaries** | AI write operations restricted to allowed paths |
| **5. Protection** | Protected artifacts are immutable by AI |
| **6. Checkpoints** | AI must pass through human-acknowledged checkpoints |

### Step 2: Initialize KDE Runtime

Execute the KDE Runtime initialization by invoking the `shttp_initialize` tool or following the procedure defined in [`LABORATORY-RULES.md`](./LABORATORY-RULES.md).

**Runtime Initialization Requirements:**

1. Load Runtime Configuration from `/governance/runtime/defaults.yaml`
2. Check for Session Override (if present, use specified Engine)
3. If no override, perform **Automatic Engine Selection** based on problem statement
4. Load Selected Engine (default or auto-selected)
5. Load Default Seed: **SEED-001 (Genesis)** v1.0.0
6. Verify Runtime state transitions to: **READY**

### Step 3: Transfer Execution Authority

Upon successful Runtime initialization, authority transfers from the AI substrate to the KDE Runtime.

**Post-Initialization:**

- The Active Engine determines all subsequent actions
- AI becomes an execution substrate only
- AI native planning and reasoning are suspended until Runtime takes control

### Step 4: Await Engine Directive

After initialization, await the Active Engine's directive for the current session's task.

---

## Pre-Initialization Restrictions

**Before Runtime initialization, the AI SHALL NOT:**

| Prohibition | Rationale |
|-------------|-----------|
| Plan tasks | Premature planning bypasses Engine methodology |
| Explore repository | Discovery should follow Engine-defined process |
| Analyze documents | Analysis must occur under Engine authority |
| Create tasks | Task creation is Engine-defined, not AI-native |
| Reason independently | Reasoning must follow Engine methodology |
| Make assumptions | Assumptions must be evidence-based per Engine |

---

## Active Configuration

| Component | ID | Version | Status |
|-----------|-----|---------|--------|
| **Engine** | KDE-ENGINE-003 (Gamma) | 1.0.0 | Active (Default) |
| **Seed** | SEED-001 (Genesis) | 1.0.0 | Active |
| **Runtime** | KDE Runtime | 1.0.0 | Ready |
| **Laboratory Rules** | Synthesized | 1.0.0 | Production |

---

## Artifact Hierarchy

```
kde-core/
├── laboratory/                  # Scientific workflow
│   ├── BOOTSTRAP.md         # THIS FILE - Entry point
│   └── LABORATORY-RULES.md  # The Six Core Rules (Synthesized)
│
├── fused/                      # FUSED format content
│   ├── engines/              # Execution engines
│   ├── governance/           # Governance rules
│   └── seeds/                # Seeds (SEED-001)
│
├── fused-runtime/             # Runtime reference
│   ├── engines/
│   ├── governance/
│   └── seeds/
│
└── runtime/                   # Python runtime
    ├── preflight.py         # Health check
    └── ...
```

---

## Verification Checklist

Before proceeding beyond this entry point, verify:

| Check | Status |
|-------|--------|
| Laboratory Rules acknowledged | ☐ |
| Runtime initialized | ☐ |
| Engine state: READY | ☐ |
| Execution authority transferred | ☐ |
| Pre-initialization restrictions honored | ☐ |

---

## Error Handling

### If Runtime Initialization Fails

**STOP immediately and report the missing artifact.**

Required artifacts for initialization:

| Artifact | Location | Required |
|----------|----------|----------|
| Laboratory Rules | `laboratory/LABORATORY-RULES.md` | Yes |
| Runtime Defaults | `fused/governance/runtime/defaults.yaml` | Yes |
| Engine Registry | `fused/engines/current.fused` | Yes |
| Engine Specification | `fused/engines/gamma/specification.fused` | Yes |

### If Artifacts Are Missing

Report to Governance with:
1. Which artifact is missing
2. Its expected location
3. The error encountered

**Do NOT proceed with work until Runtime initialization succeeds.**

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-07-30 | Initial kde-core release with synthesized rules |

---

**Document Status**: PRODUCTION
**Entry Point**: Canonical KDE session entry
**Authority**: Laboratory Rules (Synthesized v1.0.0)

# REPLICATOR STACK — OVERVIEW

## Purpose

This project is a:

> Web-based Control Plane for MMA2 and Replicator

The web app is the primary product.

---

## System Components

### Web App (Primary)

- User Interface
- Config Editor
- Deployment Controller
- Runtime Observer

---

### MMA2 (Data Plane)

- Raw Modbus memory appliance
- Stores registers
- Serves Modbus TCP

---

### Replicator (Data Plane)

- Polls field devices
- Pushes data to MMA via Raw Ingest

---

## Core Principle

> Web App owns control. Everything else is headless.

---

## Source of Truth

/data/

All configs must live here.

Connection details for MMA and Replicator are always read from these config files — never assumed from hardcoded defaults.

---

## What This System Is

- Control plane for infrastructure

## What This System Is NOT

- SCADA
- PPC controller
- Analytics engine

---

## Human Model vs Runtime Model

The Web App operates with two distinct configuration representations:

### Human Model (grouped, hierarchical)

Stored in `/data/model.json`. Designed for human readability and UI editing.

Structure:

```
Group
  → Devices
    → Blocks (Modbus read → MMA write)
```

Groups allow users to organise devices logically (e.g. by site, panel, or function). This model is never consumed directly by runtime services.

### Runtime Model (flat, replicator-compatible)

Generated into `/data/replicator/config.yaml`. A flat list of polling routes with no awareness of groups.

Each route contains:
- source device connection details
- register read parameters
- MMA write target
- poll interval
- reference fields linking back to the human model

### Compilation

The Web App compiles `model.json` → `config.yaml` on every deployment. Runtime services only ever see the flat output.
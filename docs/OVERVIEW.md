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

---

## What This System Is

- Control plane for infrastructure

## What This System Is NOT

- SCADA
- PPC controller
- Analytics engine
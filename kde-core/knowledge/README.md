# KDE Knowledge Layer

**First-class repository component for engineering knowledge.**

---

## Overview

The Knowledge Layer is a materialized component that transforms KDE laboratory artifacts into persistent, queryable knowledge objects.

## Directory Structure

```
knowledge/
├── collected/           # Collected artifact data
├── objects/            # Knowledge objects (one per file)
├── relationships/       # Relationships between objects
├── patterns/           # Discovered patterns
├── principles/         # Engineering principles
├── fused/             # Fused higher-level knowledge
├── indexes/           # Repository indexes
│   ├── object_index.yaml
│   ├── type_index.yaml
│   ├── artifact_index.yaml
│   └── confidence_index.yaml
├── schema.py          # Data schemas
├── layer.py           # Implementation
├── repository.yaml    # Repository manifest
└── README.md         # This file
```

## Usage

```python
from knowledge.layer import KnowledgeLayer

# Initialize
layer = KnowledgeLayer()

# Materialize from artifacts
layer.materialize()

# Query objects
objects = glob.glob('knowledge/objects/*.yaml')

# Check manifest
manifest = layer._load_yaml('knowledge/repository.yaml')
print(manifest['object_count'])
```

## Commands

```bash
# Materialize knowledge layer
python3 knowledge/layer.py

# View repository manifest
cat knowledge/repository.yaml
```

## Schema

Every Knowledge Object contains:

- `id`: Unique identifier
- `type`: Object type (principle, pattern, insight, etc.)
- `title`: Human-readable title
- `statement`: The knowledge statement
- `evidence`: List of evidence references
- `source_artifacts`: Original artifact IDs
- `confidence`: Confidence score (0-1)
- `status`: Lifecycle status
- `relationships`: Linked objects
- `provenance`: Traceability information

## Indexes

The repository maintains indexes for:

- **Object Index**: ID → filepath mapping
- **Type Index**: Object type → object IDs
- **Artifact Index**: Artifact ID → knowledge object IDs
- **Confidence Index**: Objects ranked by confidence

## Status

**ACTIVE** - Knowledge Layer is operational.

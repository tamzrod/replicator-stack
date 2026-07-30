"""
KDE Knowledge Layer - Schema Definitions
Canonical Knowledge Object structure and types.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Dict, Any, Optional
from enum import Enum
import uuid


class KnowledgeType(Enum):
    """Types of knowledge objects."""
    PRINCIPLE = "principle"
    PATTERN = "pattern"
    RULE = "rule"
    INSIGHT = "insight"
    FINDING = "finding"
    CONCLUSION = "conclusion"
    RECOMMENDATION = "recommendation"
    EVIDENCE = "evidence"
    RELATIONSHIP = "relationship"
    FUSED = "fused"


class KnowledgeStatus(Enum):
    """Lifecycle status of knowledge objects."""
    DRAFT = "draft"
    VALIDATED = "validated"
    ACTIVE = "active"
    DEPRECATED = "deprecated"
    SUPERSEDED = "superseded"


class RelationshipType(Enum):
    """Types of relationships between knowledge objects."""
    SUPPORTS = "supports"
    CONTRADICTS = "contradicts"
    DERIVED_FROM = "derived_from"
    RELATED_TO = "related_to"
    EXTENDS = "extends"
    SUPERSEDES = "supersedes"
    DEPENDS_ON = "depends_on"
    REFINES = "refines"


@dataclass
class KnowledgeObject:
    """Canonical Knowledge Object structure."""
    id: str
    type: KnowledgeType
    title: str
    statement: str
    evidence: List[str] = field(default_factory=list)
    source_artifacts: List[str] = field(default_factory=list)
    confidence: float = 0.5
    status: KnowledgeStatus = KnowledgeStatus.DRAFT
    relationships: List[Dict[str, str]] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    version: str = "1.0.0"
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    provenance: Dict[str, str] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'type': self.type.value,
            'title': self.title,
            'statement': self.statement,
            'evidence': self.evidence,
            'source_artifacts': self.source_artifacts,
            'confidence': self.confidence,
            'status': self.status.value,
            'relationships': self.relationships,
            'metadata': self.metadata,
            'version': self.version,
            'created_at': self.created_at,
            'updated_at': self.updated_at,
            'provenance': self.provenance
        }

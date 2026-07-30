"""
KDE Implementation Layer - Schema Definitions
Implementation Object structure and types.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Dict, Any, Optional
from enum import Enum
import uuid
import os
import yaml


class ImplementationTarget(Enum):
    """Target of implementation."""
    INTERNAL = "internal"  # KDE itself
    EXTERNAL = "external"   # Host repository


class ImplementationStatus(Enum):
    """Status of implementation."""
    PROPOSAL = "proposal"
    APPROVED = "approved"
    REJECTED = "rejected"
    IN_SANDBOX = "in_sandbox"
    VALIDATING = "validating"
    COMPLETED = "completed"
    FAILED = "failed"


class ImplementationPriority(Enum):
    """Priority of implementation."""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


@dataclass
class ImplementationObject:
    """Canonical Implementation Object structure."""
    id: str
    title: str
    target: ImplementationTarget
    source_knowledge: List[str] = field(default_factory=list)  # Knowledge object IDs
    supporting_evidence: List[str] = field(default_factory=list)
    reason: str = ""
    expected_benefit: str = ""
    risk: str = "low"
    priority: ImplementationPriority = ImplementationPriority.MEDIUM
    status: ImplementationStatus = ImplementationStatus.PROPOSAL
    validation_requirements: List[str] = field(default_factory=list)
    implementation_details: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)
    version: str = "1.0.0"
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'title': self.title,
            'target': self.target.value,
            'source_knowledge': self.source_knowledge,
            'supporting_evidence': self.supporting_evidence,
            'reason': self.reason,
            'expected_benefit': self.expected_benefit,
            'risk': self.risk,
            'priority': self.priority.value,
            'status': self.status.value,
            'validation_requirements': self.validation_requirements,
            'implementation_details': self.implementation_details,
            'metadata': self.metadata,
            'version': self.version,
            'created_at': self.created_at,
            'updated_at': self.updated_at
        }
    
    def to_yaml(self) -> str:
        return yaml.dump(self.to_dict(), default_flow_style=False)


@dataclass
class SandboxResult:
    """Result of sandbox validation."""
    id: str
    implementation_id: str
    status: str  # pass, fail, error
    correctness: bool = True
    evidence_verified: bool = True
    regression_passed: bool = True
    implementation_review: str = ""
    runtime_verified: bool = True
    output: str = ""
    errors: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'implementation_id': self.implementation_id,
            'status': self.status,
            'correctness': self.correctness,
            'evidence_verified': self.evidence_verified,
            'regression_passed': self.regression_passed,
            'implementation_review': self.implementation_review,
            'runtime_verified': self.runtime_verified,
            'output': self.output,
            'errors': self.errors,
            'created_at': self.created_at
        }

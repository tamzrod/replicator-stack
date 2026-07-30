"""
TraceManager - Mandatory trace artifact generation

Generates TRACE-INIT, TRACE-PHASE, and TRACE-COMPLETE artifacts.
Required before any investigation can be accepted.

Part of INV-014 trace enforcement implementation.
"""

import uuid
import hashlib
from datetime import datetime
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field, asdict
from enum import Enum


class TraceError(Exception):
    """Raised when trace requirements are not met."""
    pass


class TraceType(Enum):
    """Types of trace artifacts."""
    INIT = "TRACE-INIT"
    PHASE = "TRACE-PHASE"
    ARTIFACT = "TRACE-ARTIFACT"
    ERROR = "TRACE-ERROR"
    COMPLETE = "TRACE-COMPLETE"


@dataclass
class Trace:
    """A single trace artifact."""
    trace_id: str
    trace_type: str
    parent_trace: Optional[str] = None
    timestamp: str = ""
    data: Dict[str, Any] = field(default_factory=dict)
    content_hash: Optional[str] = None
    
    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.utcnow().isoformat() + "Z"
        if not self.content_hash:
            self.content_hash = self._compute_hash()
    
    def _compute_hash(self) -> str:
        """Compute content hash for integrity verification."""
        content = f"{self.trace_id}:{self.trace_type}:{self.timestamp}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return asdict(self)
    
    def to_yaml(self) -> str:
        """Convert to YAML-like string for file output."""
        lines = [
            f"{self.trace_type}:",
            f"  trace_id: {self.trace_id}",
            f"  timestamp: {self.timestamp}",
            f"  content_hash: {self.content_hash}",
        ]
        if self.parent_trace:
            lines.append(f"  parent_trace: {self.parent_trace}")
        for key, value in self.data.items():
            lines.append(f"  {key}: {value}")
        return "\n".join(lines)


class TraceManager:
    """
    Manages trace artifact generation for investigations.
    
    Usage:
        trace = TraceManager(investigation_id="INV-012")
        trace.init(engine_id="KDE-ENGINE-003")
        trace.phase("method_name", inputs={...})
        trace.complete()
    """
    
    def __init__(self, investigation_id: str, strict: bool = True):
        """
        Initialize TraceManager.
        
        Args:
            investigation_id: ID of the investigation
            strict: If True, raises error on violations (default: True)
        """
        self.investigation_id = investigation_id
        self.strict = strict
        self._traces: List[Trace] = []
        self._initialized = False
        self._completed = False
        self._phase_count = 0
        self._session_uuid = str(uuid.uuid4())
    
    @property
    def session_uuid(self) -> str:
        """Get the session UUID."""
        return self._session_uuid
    
    @property
    def is_initialized(self) -> bool:
        """Check if TRACE-INIT has been generated."""
        return self._initialized
    
    @property
    def is_complete(self) -> bool:
        """Check if TRACE-COMPLETE has been generated."""
        return self._completed
    
    @property
    def phase_count(self) -> int:
        """Get number of phase traces generated."""
        return self._phase_count
    
    def init(self, engine_id: str, engine_version: str = "0.1.0") -> Trace:
        """
        Generate TRACE-INIT artifact.
        
        MUST be called before any other trace operations.
        
        Args:
            engine_id: Engine identifier (e.g., "KDE-ENGINE-003")
            engine_version: Engine version string
            
        Returns:
            Trace object
            
        Raises:
            TraceError: If TRACE-INIT already exists
        """
        if self._initialized:
            error = "TRACE-INIT already generated"
            if self.strict:
                raise TraceError(error)
            return None
        
        self._initialized = True
        
        trace = Trace(
            trace_id=f"TRACE-INIT-{self._session_uuid[:8]}",
            trace_type=TraceType.INIT.value,
            data={
                'engine_id': engine_id,
                'engine_version': engine_version,
                'investigation_id': self.investigation_id,
                'session_uuid': self._session_uuid,
                'strict_mode': self.strict,
            }
        )
        
        self._traces.append(trace)
        return trace
    
    def phase(self, method_name: str, inputs: Optional[Dict] = None, 
              outputs: Optional[Dict] = None) -> Trace:
        """
        Generate TRACE-PHASE artifact.
        
        MUST be called after init and before complete.
        
        Args:
            method_name: Name of the method being traced
            inputs: Method input parameters
            outputs: Method output/result
            
        Returns:
            Trace object
            
        Raises:
            TraceError: If not initialized or already complete
        """
        if not self._initialized:
            error = "TRACE-INIT required before TRACE-PHASE"
            if self.strict:
                raise TraceError(error)
            return None
        
        if self._completed:
            error = "TRACE-COMPLETE already generated - cannot add more phases"
            if self.strict:
                raise TraceError(error)
            return None
        
        self._phase_count += 1
        parent = self._traces[0]  # First trace is always INIT
        
        trace = Trace(
            trace_id=f"TRACE-PHASE-{self._phase_count}-{uuid.uuid4().hex[:8]}",
            trace_type=TraceType.PHASE.value,
            parent_trace=parent.trace_id if parent else None,
            data={
                'method': method_name,
                'inputs': inputs or {},
                'outputs': outputs or {},
                'phase_number': self._phase_count,
            }
        )
        
        self._traces.append(trace)
        return trace
    
    def artifact(self, artifact_id: str, artifact_type: str, 
                 content: Any = None) -> Trace:
        """
        Generate TRACE-ARTIFACT artifact.
        
        Documents that an investigation artifact was produced.
        
        Args:
            artifact_id: Unique artifact identifier
            artifact_type: Type of artifact (e.g., "knowledge", "evidence")
            content: Optional content for hash verification
            
        Returns:
            Trace object
        """
        if not self._initialized:
            error = "TRACE-INIT required before TRACE-ARTIFACT"
            if self.strict:
                raise TraceError(error)
            return None
        
        parent = self._traces[-1]  # Parent is last trace
        
        trace = Trace(
            trace_id=f"TRACE-ARTIFACT-{uuid.uuid4().hex[:8]}",
            trace_type=TraceType.ARTIFACT.value,
            parent_trace=parent.trace_id if parent else None,
            data={
                'artifact_id': artifact_id,
                'artifact_type': artifact_type,
                'content_hash': hashlib.sha256(str(content).encode()).hexdigest()[:16] if content else None,
            }
        )
        
        self._traces.append(trace)
        return trace
    
    def error(self, error_type: str, message: str, 
              stack: Optional[str] = None) -> Trace:
        """
        Generate TRACE-ERROR artifact.
        
        Documents an error that occurred during investigation.
        
        Args:
            error_type: Type of error
            message: Error message
            stack: Optional stack trace
            
        Returns:
            Trace object
        """
        if not self._initialized:
            error = "TRACE-INIT required before TRACE-ERROR"
            if self.strict:
                raise TraceError(error)
            return None
        
        parent = self._traces[-1]
        
        trace = Trace(
            trace_id=f"TRACE-ERROR-{uuid.uuid4().hex[:8]}",
            trace_type=TraceType.ERROR.value,
            parent_trace=parent.trace_id if parent else None,
            data={
                'error_type': error_type,
                'message': message,
                'stack': stack,
            }
        )
        
        self._traces.append(trace)
        return trace
    
    def complete(self, summary: Optional[Dict] = None) -> Trace:
        """
        Generate TRACE-COMPLETE artifact.
        
        MUST be called to finalize the investigation trace.
        
        Args:
            summary: Summary of investigation (phases completed, artifacts, etc.)
            
        Returns:
            Trace object
            
        Raises:
            TraceError: If not initialized
        """
        if not self._initialized:
            error = "TRACE-INIT required before TRACE-COMPLETE"
            if self.strict:
                raise TraceError(error)
            return None
        
        if self._completed:
            error = "TRACE-COMPLETE already generated"
            if self.strict:
                raise TraceError(error)
            return None
        
        self._completed = True
        parent = self._traces[0]  # First trace is always INIT
        
        summary = summary or {}
        summary.update({
            'phases_completed': self._phase_count,
            'total_traces': len(self._traces),
            'investigation_id': self.investigation_id,
        })
        
        trace = Trace(
            trace_id=f"TRACE-COMPLETE-{self._session_uuid[:8]}",
            trace_type=TraceType.COMPLETE.value,
            parent_trace=parent.trace_id if parent else None,
            data=summary
        )
        
        self._traces.append(trace)
        return trace
    
    def get_traces(self) -> List[Trace]:
        """Get all generated traces."""
        return self._traces.copy()
    
    def get_trace_ids(self) -> List[str]:
        """Get IDs of all traces."""
        return [t.trace_id for t in self._traces]
    
    def has_init(self) -> bool:
        """Check if TRACE-INIT exists."""
        return self._initialized
    
    def has_complete(self) -> bool:
        """Check if TRACE-COMPLETE exists."""
        return self._completed
    
    def validate(self) -> 'ValidationResult':
        """
        Validate the current trace state.
        
        Returns:
            ValidationResult with validation status and any errors
        """
        from .validator import TraceValidator, ValidationResult
        
        validator = TraceValidator()
        return validator.validate_traces(self._traces)
    
    def write_to_file(self, filepath: str) -> None:
        """
        Write all traces to a file.
        
        Args:
            filepath: Path to output file
        """
        lines = [
            f"# Trace Log for {self.investigation_id}",
            f"# Generated: {datetime.utcnow().isoformat()}Z",
            f"# Session: {self._session_uuid}",
            "",
        ]
        
        for trace in self._traces:
            lines.append(trace.to_yaml())
            lines.append("")
        
        with open(filepath, 'w') as f:
            f.write("\n".join(lines))
    
    def __repr__(self) -> str:
        return (f"TraceManager(investigation_id={self.investigation_id}, "
                f"initialized={self._initialized}, "
                f"phases={self._phase_count}, "
                f"complete={self._completed})")

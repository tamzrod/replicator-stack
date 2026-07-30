"""
Engine Selection Tracer

Traces the ECU engine selection process.
Every engine selection is now tracked and verified.

Part of trace enforcement for the full investigation lifecycle.
"""

import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field, asdict
from enum import Enum


class SelectionType(Enum):
    """Types of engine selection."""
    AUTO = "AUTO"  # ECU selected based on capabilities
    MANUAL = "MANUAL"  # Human specified
    DEFAULT = "DEFAULT"  # Fallback to default


@dataclass
class EngineSelectionTrace:
    """Trace of an engine selection."""
    selection_id: str
    selection_type: str
    engine_id: str
    engine_name: str
    engine_version: str
    selection_reason: str
    alternatives_considered: List[str]
    confidence: float
    timestamp: str
    request_keywords: List[str]
    matched_capabilities: List[str]


class EngineSelectionTracer:
    """
    Traces engine selection decisions by the ECU.
    
    Every engine selection is now:
    1. Traced with full reasoning
    2. Linked to TRACE-INIT
    3. Included in TRACE-COMPLETE
    
    Usage:
        tracer = EngineSelectionTracer()
        
        # Before ECU selects engine
        tracer.pre_selection(request_keywords=['causal', 'discovery'])
        
        # After ECU selects engine
        tracer.select_engine(
            engine_id='KDE-ENGINE-003',
            engine_name='Gamma',
            reason='Best match for causal_discovery capability',
            alternatives=['Alpha', 'Beta'],
            confidence=0.95
        )
        
        # Get full selection trace
        trace = tracer.get_selection_trace()
    """
    
    def __init__(self, investigation_id: str):
        """
        Initialize the selection tracer.
        
        Args:
            investigation_id: ID of the investigation
        """
        self.investigation_id = investigation_id
        self._selection_started = False
        self._engine_selected = False
        self._selection: Optional[EngineSelectionTrace] = None
        self._alternatives: List[Dict] = []
        self._request_keywords: List[str] = []
        self._session_uuid = str(uuid.uuid4())
    
    def pre_selection(self, request_keywords: List[str]) -> None:
        """
        Mark that selection process has started.
        
        Args:
            request_keywords: Keywords from the request
        """
        self._selection_started = True
        self._request_keywords = request_keywords
        self._alternatives = []
    
    def consider_alternative(self, engine_id: str, engine_name: str, 
                           score: float, reason: str) -> None:
        """
        Record an engine that was considered but not selected.
        
        Args:
            engine_id: Engine ID
            engine_name: Engine name
            score: Match score
            reason: Why it was considered
        """
        self._alternatives.append({
            'engine_id': engine_id,
            'engine_name': engine_name,
            'score': score,
            'reason': reason,
            'selected': False
        })
    
    def select_engine(self, 
                     engine_id: str,
                     engine_name: str,
                     engine_version: str,
                     reason: str,
                     confidence: float,
                     selection_type: str = "AUTO") -> EngineSelectionTrace:
        """
        Record the selected engine.
        
        Args:
            engine_id: Selected engine ID
            engine_name: Selected engine name
            engine_version: Selected engine version
            reason: Why this engine was selected
            confidence: Selection confidence (0-1)
            selection_type: AUTO, MANUAL, or DEFAULT
            
        Returns:
            EngineSelectionTrace with full selection details
        """
        # Mark best alternative
        for alt in self._alternatives:
            if alt['engine_id'] == engine_id:
                alt['selected'] = True
        
        self._engine_selected = True
        
        self._selection = EngineSelectionTrace(
            selection_id=f"SEL-{self._session_uuid[:8]}",
            selection_type=selection_type,
            engine_id=engine_id,
            engine_name=engine_name,
            engine_version=engine_version,
            selection_reason=reason,
            alternatives_considered=[a['engine_id'] for a in self._alternatives],
            confidence=confidence,
            timestamp=datetime.utcnow().isoformat() + "Z",
            request_keywords=self._request_keywords,
            matched_capabilities=self._extract_capabilities(reason)
        )
        
        return self._selection
    
    def select_default(self, default_engine: str) -> EngineSelectionTrace:
        """
        Select default engine when no better option found.
        
        Args:
            default_engine: Default engine ID
            
        Returns:
            EngineSelectionTrace
        """
        return self.select_engine(
            engine_id=default_engine,
            engine_name="Default",
            engine_version="1.0.0",
            reason="No matching engine found, using default",
            confidence=0.5,
            selection_type="DEFAULT"
        )
    
    def _extract_capabilities(self, reason: str) -> List[str]:
        """Extract capabilities mentioned in reason."""
        capabilities = []
        capability_keywords = [
            'causal', 'discovery', 'synthesis', 'analysis',
            'temporal', 'comparison', 'validation', 'evolution'
        ]
        for cap in capability_keywords:
            if cap in reason.lower():
                capabilities.append(cap)
        return capabilities if capabilities else ['general']
    
    def get_selection_trace(self) -> Optional[EngineSelectionTrace]:
        """Get the full selection trace."""
        return self._selection
    
    def get_summary(self) -> Dict[str, Any]:
        """Get a summary of the selection."""
        if not self._selection:
            return {
                'started': self._selection_started,
                'selected': False,
                'investigation_id': self.investigation_id
            }
        
        return {
            'selection_id': self._selection.selection_id,
            'investigation_id': self.investigation_id,
            'engine_id': self._selection.engine_id,
            'engine_name': self._selection.engine_name,
            'selection_type': self._selection.selection_type,
            'confidence': self._selection.confidence,
            'alternatives_count': len(self._alternatives),
            'selected_from_alternatives': len(self._alternatives) > 0
        }
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        if not self._selection:
            return {
                'investigation_id': self.investigation_id,
                'selection_started': self._selection_started,
                'engine_selected': False
            }
        
        return asdict(self._selection)
    
    def to_yaml(self) -> str:
        """Convert to YAML-like string."""
        if not self._selection:
            return f"""ENGINE-SELECTION:
  investigation_id: {self.investigation_id}
  selection_started: {self._selection_started}
  engine_selected: false"""
        
        s = self._selection
        alternatives = "\n".join([
            f"      - {a['engine_id']} (score: {a['score']})"
            for a in self._alternatives
        ])
        
        return f"""ENGINE-SELECTION:
  selection_id: {s.selection_id}
  selection_type: {s.selection_type}
  engine_id: {s.engine_id}
  engine_name: {s.engine_name}
  engine_version: {s.engine_version}
  selection_reason: {s.selection_reason}
  confidence: {s.confidence}
  timestamp: {s.timestamp}
  request_keywords: {s.request_keywords}
  matched_capabilities: {s.matched_capabilities}
  alternatives_considered:
{alternatives if alternatives else "      []"}"""


class ECUSelectionTrace:
    """
    Full ECU selection trace including engine and seed selection.
    
    Tracks:
    1. Engine selection
    2. Seed selection
    3. Execution plan selection
    
    Usage:
        trace = ECUSelectionTrace('INV-012')
        
        trace.engine_selection = engine_tracer.get_selection_trace()
        trace.seed_selection = seed_tracer.get_selection_trace()
        trace.execution_plan = plan_tracer.get_plan_trace()
        
        # Write to file
        trace.write_to_file('TRACE.md')
    """
    
    def __init__(self, investigation_id: str):
        """Initialize ECU selection trace."""
        self.investigation_id = investigation_id
        self.engine_tracer = EngineSelectionTracer(investigation_id)
        self._timestamp = datetime.utcnow().isoformat() + "Z"
        self._session_uuid = str(uuid.uuid4())
    
    @property
    def trace_id(self) -> str:
        """Get the trace ID."""
        return f"TRACE-SELECT-{self._session_uuid[:8]}"
    
    def write_to_file(self, filepath: str) -> None:
        """Write selection trace to file."""
        lines = [
            f"# Engine Selection Trace",
            f"# Investigation: {self.investigation_id}",
            f"# Trace ID: {self.trace_id}",
            f"# Timestamp: {self._timestamp}",
            "",
            self.engine_tracer.to_yaml(),
        ]
        
        with open(filepath, 'w') as f:
            f.write("\n".join(lines))
    
    def get_summary(self) -> Dict[str, Any]:
        """Get summary of all selections."""
        return {
            'trace_id': self.trace_id,
            'investigation_id': self.investigation_id,
            'engine_selection': self.engine_tracer.get_summary(),
            'timestamp': self._timestamp
        }

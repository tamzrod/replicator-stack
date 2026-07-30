"""
ECU Trace Module

Mandatory trace layer for engine execution verification.
Part of INV-014 trace enforcement implementation.

Usage:
    from runtime.ecu.trace import TraceManager, TraceValidator
    
    # Initialize trace manager
    trace = TraceManager(investigation_id="INV-012")
    
    # Generate mandatory traces
    trace.init(engine_id="KDE-ENGINE-003", engine_version="0.1.0")
    
    # Trace each phase
    trace.phase("analyzeevidence", inputs={...}, outputs={...})
    
    # Complete investigation
    trace.complete(summary={...})
    
    # Validate
    validator = TraceValidator()
    result = validator.validate(trace.get_traces())
"""

from .manager import TraceManager, TraceError
from .validator import TraceValidator, ValidationResult
from .enforcer import TraceEnforcer, TraceEnforcementError

__all__ = [
    'TraceManager',
    'TraceError',
    'TraceValidator', 
    'ValidationResult',
    'TraceEnforcer',
    'TraceEnforcementError'
]

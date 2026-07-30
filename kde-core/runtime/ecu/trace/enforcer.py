"""
TraceEnforcer - ECU Integration for Trace Enforcement

Integrates trace enforcement into the ECU bootstrap and execution flow.
Prevents investigations without traces from being accepted.

Part of INV-014 trace enforcement implementation.
"""

from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
from datetime import datetime

from .manager import TraceManager, TraceError, TraceType
from .validator import TraceValidator, ValidationResult, ValidationStatus


class TraceEnforcementError(Exception):
    """Raised when trace enforcement blocks an operation."""
    pass


@dataclass
class EnforcerConfig:
    """Configuration for trace enforcement."""
    enabled: bool = True
    strict_mode: bool = True
    expected_phases: int = 4
    allow_missing_init: bool = False  # For backwards compatibility
    log_enforcement: bool = True


class TraceEnforcer:
    """
    Enforces trace requirements in the ECU execution flow.
    
    Usage:
        enforcer = TraceEnforcer(config=EnforcerConfig())
        
        # Before investigation
        enforcer.pre_investigation(investigation_id="INV-012", engine_id="KDE-003")
        
        # During investigation
        enforcer.trace_phase("analyzeevidence", inputs={...})
        
        # After investigation
        enforcer.post_investigation(summary={...})
        
        # Validate
        result = enforcer.validate()
        if not result.valid:
            raise TraceEnforcementError(result.errors)
    """
    
    def __init__(self, config: Optional[EnforcerConfig] = None):
        """
        Initialize TraceEnforcer.
        
        Args:
            config: Enforcer configuration
        """
        self.config = config or EnforcerConfig()
        self._trace_manager: Optional[TraceManager] = None
        self._investigation_id: Optional[str] = None
        self._engine_id: Optional[str] = None
        self._investigation_started: bool = False
        self._investigation_completed: bool = False
    
    @property
    def is_initialized(self) -> bool:
        """Check if TRACE-INIT has been generated."""
        return self._trace_manager is not None and self._trace_manager.has_init()
    
    @property
    def is_complete(self) -> bool:
        """Check if TRACE-COMPLETE has been generated."""
        return self._trace_manager is not None and self._trace_manager.has_complete()
    
    @property
    def trace_manager(self) -> Optional[TraceManager]:
        """Get the trace manager."""
        return self._trace_manager
    
    def pre_investigation(self, investigation_id: str, 
                          engine_id: str) -> TraceManager:
        """
        Prepare for investigation - generates TRACE-INIT.
        
        MUST be called before any investigation work.
        
        Args:
            investigation_id: ID of the investigation
            engine_id: Engine being used
            
        Returns:
            TraceManager instance
            
        Raises:
            TraceEnforcementError: If enforcement is enabled and pre-check fails
        """
        if not self.config.enabled:
            if self.config.log_enforcement:
                print(f"[TRACE] Enforcement disabled, skipping TRACE-INIT for {investigation_id}")
            return None
        
        # Create trace manager
        self._trace_manager = TraceManager(
            investigation_id=investigation_id,
            strict=self.config.strict_mode
        )
        self._investigation_id = investigation_id
        self._engine_id = engine_id
        
        # Generate TRACE-INIT
        try:
            self._trace_manager.init(
                engine_id=engine_id,
                engine_version="0.1.0"  # TODO: Get from engine registry
            )
            self._investigation_started = True
            
            if self.config.log_enforcement:
                print(f"[TRACE] TRACE-INIT generated for {investigation_id}")
            
            return self._trace_manager
            
        except TraceError as e:
            raise TraceEnforcementError(f"TRACE-INIT failed: {e}")
    
    def trace_phase(self, method_name: str, 
                    inputs: Optional[Dict] = None,
                    outputs: Optional[Dict] = None) -> None:
        """
        Trace an investigation phase.
        
        MUST be called after pre_investigation and before post_investigation.
        
        Args:
            method_name: Name of the method being traced
            inputs: Method inputs
            outputs: Method outputs
        """
        if not self.config.enabled:
            return
        
        if not self._trace_manager:
            error = "pre_investigation() must be called before trace_phase()"
            if self.config.strict_mode:
                raise TraceEnforcementError(error)
            if self.config.log_enforcement:
                print(f"[TRACE-WARN] {error}")
            return
        
        if self._investigation_completed:
            error = "post_investigation() already called - cannot add more phases"
            if self.config.strict_mode:
                raise TraceEnforcementError(error)
            if self.config.log_enforcement:
                print(f"[TRACE-WARN] {error}")
            return
        
        try:
            self._trace_manager.phase(method_name, inputs, outputs)
            
            if self.config.log_enforcement:
                print(f"[TRACE] TRACE-PHASE-{self._trace_manager.phase_count}: {method_name}")
                
        except TraceError as e:
            raise TraceEnforcementError(f"TRACE-PHASE failed: {e}")
    
    def trace_artifact(self, artifact_id: str, artifact_type: str,
                       content: Any = None) -> None:
        """
        Trace an artifact produced by the investigation.
        
        Args:
            artifact_id: Unique artifact identifier
            artifact_type: Type of artifact
            content: Optional content for verification
        """
        if not self.config.enabled:
            return
        
        if not self._trace_manager:
            return
        
        try:
            self._trace_manager.artifact(artifact_id, artifact_type, content)
            
            if self.config.log_enforcement:
                print(f"[TRACE] TRACE-ARTIFACT: {artifact_id} ({artifact_type})")
                
        except TraceError as e:
            if self.config.strict_mode:
                raise TraceEnforcementError(f"TRACE-ARTIFACT failed: {e}")
    
    def trace_error(self, error_type: str, message: str,
                    stack: Optional[str] = None) -> None:
        """
        Trace an error that occurred during investigation.
        
        Args:
            error_type: Type of error
            message: Error message
            stack: Optional stack trace
        """
        if not self.config.enabled:
            return
        
        if not self._trace_manager:
            return
        
        try:
            self._trace_manager.error(error_type, message, stack)
            
            if self.config.log_enforcement:
                print(f"[TRACE] TRACE-ERROR: {error_type}")
                
        except TraceError:
            pass  # Don't fail on error trace
    
    def post_investigation(self, summary: Optional[Dict] = None) -> ValidationResult:
        """
        Complete investigation - generates TRACE-COMPLETE.
        
        MUST be called after all investigation work is done.
        
        Args:
            summary: Investigation summary
            
        Returns:
            ValidationResult
            
        Raises:
            TraceEnforcementError: If TRACE-COMPLETE fails
        """
        if not self.config.enabled:
            return ValidationResult(valid=True, status=ValidationStatus.VALID)
        
        if not self._trace_manager:
            error = "pre_investigation() must be called before post_investigation()"
            if self.config.strict_mode:
                raise TraceEnforcementError(error)
            if self.config.log_enforcement:
                print(f"[TRACE-WARN] {error}")
            return ValidationResult(valid=False, status=ValidationStatus.REJECTED)
        
        if self._investigation_completed:
            error = "post_investigation() already called"
            if self.config.strict_mode:
                raise TraceEnforcementError(error)
            return ValidationResult(valid=True, status=ValidationStatus.VALID)
        
        self._investigation_completed = True
        summary = summary or {}
        summary.update({
            'investigation_id': self._investigation_id,
            'engine_id': self._engine_id,
            'completed_at': datetime.utcnow().isoformat() + "Z",
        })
        
        try:
            self._trace_manager.complete(summary)
            
            if self.config.log_enforcement:
                print(f"[TRACE] TRACE-COMPLETE generated for {self._investigation_id}")
            
            # Validate
            return self.validate()
            
        except TraceError as e:
            raise TraceEnforcementError(f"TRACE-COMPLETE failed: {e}")
    
    def validate(self) -> ValidationResult:
        """
        Validate the investigation traces.
        
        Returns:
            ValidationResult with validation status
        """
        if not self.config.enabled:
            return ValidationResult(valid=True, status=ValidationStatus.VALID)
        
        if not self._trace_manager:
            result = ValidationResult(
                valid=False,
                status=ValidationStatus.REJECTED,
            )
            result.add_error("TRACE-INIT", "E001", "No traces generated")
            return result
        
        # Quick check for TRACE-INIT
        validator = TraceValidator(expected_phases=self.config.expected_phases)
        quick_result = validator.reject_if_no_init(self._trace_manager.get_traces())
        
        if not quick_result.valid:
            if self.config.log_enforcement:
                print(f"[TRACE-REJECT] {quick_result.errors[0].message}")
            return quick_result
        
        # Full validation
        return self._trace_manager.validate()
    
    def enforce(self) -> ValidationResult:
        """
        Enforce trace requirements - validates and raises if invalid.
        
        Returns:
            ValidationResult
            
        Raises:
            TraceEnforcementError: If traces are invalid
        """
        result = self.validate()
        
        if not result.valid:
            if self.config.strict_mode:
                raise TraceEnforcementError(
                    f"Trace enforcement failed: {result.errors}"
                )
        
        return result
    
    def write_trace_file(self, filepath: str) -> None:
        """
        Write traces to file.
        
        Args:
            filepath: Output file path
        """
        if not self._trace_manager:
            raise TraceEnforcementError("No traces to write")
        
        self._trace_manager.write_to_file(filepath)
        
        if self.config.log_enforcement:
            print(f"[TRACE] Traces written to {filepath}")
    
    def get_trace_report(self) -> Dict[str, Any]:
        """
        Get a report of trace status.
        
        Returns:
            Dictionary with trace status
        """
        if not self._trace_manager:
            return {
                'initialized': False,
                'complete': False,
                'phase_count': 0,
                'traces': [],
            }
        
        traces = self._trace_manager.get_traces()
        validation = self.validate()
        
        return {
            'investigation_id': self._investigation_id,
            'engine_id': self._engine_id,
            'initialized': self.is_initialized,
            'complete': self.is_complete,
            'phase_count': self._trace_manager.phase_count,
            'total_traces': len(traces),
            'validation': validation.to_dict(),
            'session_uuid': self._trace_manager.session_uuid,
        }


def create_enforcer(strict: bool = True, 
                    expected_phases: int = 4) -> TraceEnforcer:
    """
    Create a TraceEnforcer with default configuration.
    
    Args:
        strict: Enable strict enforcement
        expected_phases: Expected number of phases
        
    Returns:
        Configured TraceEnforcer
    """
    config = EnforcerConfig(
        enabled=True,
        strict_mode=strict,
        expected_phases=expected_phases,
        log_enforcement=True,
    )
    return TraceEnforcer(config=config)

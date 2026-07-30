"""
Laboratory Investigation Workflow

Provides trace-enforced investigation execution through the KDE runtime.
All investigations must go through this workflow to be accepted.

Usage:
    from runtime.laboratory import InvestigationWorkflow
    
    workflow = InvestigationWorkflow()
    
    with workflow.investigate('INV-012', 'Gamma') as result:
        # Do investigation work here
        result.phase('analyzeevidence', ...)
        result.artifact('KNOW-001', 'knowledge')
    
    # Workflow automatically generates TRACE-COMPLETE and validates
    # If validation fails, investigation is rejected
"""

import os
import sys
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
from datetime import datetime
from contextlib import contextmanager

# Import trace module
try:
    from .ecu.trace import (
        TraceManager, 
        TraceValidator, 
        TraceEnforcer,
        TraceEnforcementError,
        ValidationResult,
        ValidationStatus
    )
except ImportError:
    # Try absolute import for standalone execution
    from ecu.trace import (
        TraceManager, 
        TraceValidator, 
        TraceEnforcer,
        TraceEnforcementError,
        ValidationResult,
        ValidationStatus
    )


class InvestigationWorkflowError(Exception):
    """Raised when investigation workflow fails."""
    pass


class InvestigationPhase:
    """
    Represents a phase within an investigation.
    
    Used by investigations to trace their work.
    """
    
    def __init__(self, enforcer: TraceEnforcer, investigation_id: str):
        self._enforcer = enforcer
        self._investigation_id = investigation_id
        self._phases_traced = []
    
    def analyze(self, evidence_count: int, summary: str = ""):
        """Trace evidence analysis phase."""
        self._enforcer.trace_phase(
            "analyzeevidence",
            inputs={"evidence_count": evidence_count, "summary": summary}
        )
        self._phases_traced.append("analyzeevidence")
    
    def validate(self, knowledge_id: str, valid: bool = True):
        """Trace knowledge validation phase."""
        self._enforcer.trace_phase(
            "validateknowledge",
            inputs={"knowledge_id": knowledge_id, "valid": valid}
        )
        self._phases_traced.append("validateknowledge")
    
    def generate(self, knowledge_count: int, report_id: Optional[str] = None):
        """Trace knowledge generation phase."""
        self._enforcer.trace_phase(
            "generateknowledgepipeline",
            inputs={"knowledge_count": knowledge_count}
        )
        self._phases_traced.append("generateknowledgepipeline")
    
    def report(self, report_id: str, format: str = "markdown"):
        """Trace report generation phase."""
        self._enforcer.trace_phase(
            "generatereport",
            inputs={"report_id": report_id, "format": format}
        )
        self._phases_traced.append("generatereport")
    
    def custom_phase(self, method_name: str, inputs: Dict = None, outputs: Dict = None):
        """Trace a custom phase."""
        self._enforcer.trace_phase(
            method_name,
            inputs=inputs or {},
            outputs=outputs or {}
        )
        self._phases_traced.append(method_name)
    
    def artifact(self, artifact_id: str, artifact_type: str, content: Any = None):
        """Trace an artifact produced by the investigation."""
        self._enforcer.trace_artifact(artifact_id, artifact_type, content)
    
    def error(self, error_type: str, message: str, stack: str = None):
        """Trace an error that occurred."""
        self._enforcer.trace_error(error_type, message, stack)


class InvestigationResult:
    """
    Result of an investigation workflow.
    
    Provides access to phase tracing and validation results.
    """
    
    def __init__(self, 
                 investigation_id: str,
                 engine_id: str,
                 enforcer: TraceEnforcer,
                 phases: InvestigationPhase):
        self.investigation_id = investigation_id
        self.engine_id = engine_id
        self._enforcer = enforcer
        self._phases = phases
        self._completed = False
    
    @property
    def phase(self) -> InvestigationPhase:
        """Access phase tracing."""
        return self._phases
    
    @property
    def is_valid(self) -> bool:
        """Check if investigation passed validation."""
        return self._enforcer.is_complete and self._enforcer.validate().valid
    
    def get_report(self) -> Dict[str, Any]:
        """Get trace report."""
        return self._enforcer.get_trace_report()
    
    def write_traces(self, output_dir: str):
        """Write trace file to directory."""
        os.makedirs(output_dir, exist_ok=True)
        filepath = os.path.join(output_dir, "TRACE.md")
        self._enforcer.write_trace_file(filepath)


class InvestigationWorkflow:
    """
    Trace-enforced investigation workflow.
    
    All investigations must go through this workflow to be accepted.
    The workflow enforces:
    - TRACE-INIT before investigation starts
    - TRACE-PHASE for each investigation method
    - TRACE-COMPLETE when investigation ends
    - Validation before acceptance
    
    Usage:
        workflow = InvestigationWorkflow()
        
        with workflow.investigate('INV-012', 'Gamma') as result:
            result.phase.analyze(evidence_count=14)
            result.phase.artifact('KNOW-001', 'knowledge')
        
        # Investigation automatically validated and traces written
    """
    
    def __init__(self, 
                 expected_phases: int = 4,
                 strict: bool = True,
                 auto_write_traces: bool = True):
        """
        Initialize investigation workflow.
        
        Args:
            expected_phases: Expected number of phase traces
            strict: If True, raises error on validation failure
            auto_write_traces: If True, writes traces to TRACE.md
        """
        self.expected_phases = expected_phases
        self.strict = strict
        self.auto_write_traces = auto_write_traces
        self._current_enforcer: Optional[TraceEnforcer] = None
        self._current_result: Optional[InvestigationResult] = None
    
    @contextmanager
    def investigate(self, investigation_id: str, engine_id: str):
        """
        Context manager for investigation workflow.
        
        Generates TRACE-INIT on entry, TRACE-COMPLETE on exit.
        Validates traces and raises error if invalid (in strict mode).
        
        Args:
            investigation_id: ID of the investigation (e.g., "INV-012")
            engine_id: Engine being used (e.g., "Gamma", "KDE-ENGINE-003")
            
        Yields:
            InvestigationResult with phase tracing access
            
        Raises:
            InvestigationWorkflowError: If TRACE-INIT fails or validation fails
            
        Example:
            workflow = InvestigationWorkflow()
            
            with workflow.investigate('INV-012', 'Gamma') as result:
                result.phase.analyze(evidence_count=14)
                result.phase.artifact('KNOW-001', 'knowledge')
                
                if not result.is_valid:
                    raise InvestigationWorkflowError("Invalid investigation")
        """
        enforcer = TraceEnforcer()
        phases = InvestigationPhase(enforcer, investigation_id)
        
        try:
            # Generate TRACE-INIT
            enforcer.pre_investigation(investigation_id, engine_id)
            print(f"[WORKFLOW] TRACE-INIT generated for {investigation_id}")
            
            result = InvestigationResult(investigation_id, engine_id, enforcer, phases)
            self._current_result = result
            
            yield result
            
            # Generate TRACE-COMPLETE and validate
            validation = enforcer.post_investigation({
                'outcome': 'success',
                'phases_completed': len(phases._phases_traced),
                'phases': phases._phases_traced
            })
            
            print(f"[WORKFLOW] TRACE-COMPLETE generated for {investigation_id}")
            print(f"[WORKFLOW] Validation: {validation.status.value}")
            
            # Write traces if enabled
            if self.auto_write_traces:
                trace_dir = f"laboratory/investigations/{investigation_id}"
                result.write_traces(trace_dir)
                print(f"[WORKFLOW] Traces written to {trace_dir}/TRACE.md")
            
            # Check validation
            if not validation.valid:
                error_msg = f"Investigation {investigation_id} validation failed: {validation.errors}"
                if self.strict:
                    raise InvestigationWorkflowError(error_msg)
                print(f"[WORKFLOW] WARNING: {error_msg}")
            
        except TraceEnforcementError as e:
            raise InvestigationWorkflowError(f"Trace enforcement failed: {e}")
        except Exception as e:
            # Trace the error
            if enforcer._trace_manager:
                enforcer.trace_error("InvestigationError", str(e))
            raise InvestigationWorkflowError(f"Investigation failed: {e}")
        finally:
            self._current_enforcer = None
            self._current_result = None
    
    def validate_investigation(self, investigation_path: str) -> ValidationResult:
        """
        Validate an existing investigation's traces.
        
        Args:
            investigation_path: Path to investigation directory
            
        Returns:
            ValidationResult with validation status
        """
        validator = TraceValidator(expected_phases=self.expected_phases)
        return validator.validate(investigation_path)
    
    def validate_and_report(self, investigation_path: str) -> Dict[str, Any]:
        """
        Validate investigation and return detailed report.
        
        Args:
            investigation_path: Path to investigation directory
            
        Returns:
            Dictionary with validation report
        """
        validator = TraceValidator(expected_phases=self.expected_phases)
        result = validator.validate(investigation_path)
        
        return {
            'investigation_path': investigation_path,
            'valid': result.valid,
            'status': result.status.value,
            'errors': [e.to_dict() for e in result.errors],
            'warnings': result.warnings,
            'trace_coverage': result.trace_coverage,
            'expected_phases': result.expected_phases,
            'found_phases': result.found_phases,
        }


def run_investigation(investigation_id: str, engine_id: str, 
                      expected_phases: int = 4) -> InvestigationResult:
    """
    Run an investigation with trace enforcement.
    
    This is the main entry point for all investigations.
    
    Args:
        investigation_id: ID of the investigation
        engine_id: Engine to use
        expected_phases: Expected number of phases
        
    Returns:
        InvestigationResult
        
    Example:
        result = run_investigation('INV-012', 'Gamma')
        
        result.phase.analyze(evidence_count=14)
        result.phase.artifact('KNOW-001', 'knowledge')
        
        print(f"Valid: {result.is_valid}")
    """
    workflow = InvestigationWorkflow(expected_phases=expected_phases)
    
    with workflow.investigate(investigation_id, engine_id) as result:
        yield result


# Demo
if __name__ == "__main__":
    print("=" * 60)
    print("INVESTIGATION WORKFLOW DEMO")
    print("=" * 60)
    
    workflow = InvestigationWorkflow()
    
    try:
        with workflow.investigate('INV-DEMO', 'Gamma') as result:
            # Trace investigation phases
            result.phase.analyze(evidence_count=14, summary="Initial evidence collection")
            result.phase.validate('KNOW-001', valid=True)
            result.phase.generate(knowledge_count=5)
            result.phase.report('REPORT-001')
            
            # Trace artifacts
            result.phase.artifact('KNOW-001', 'knowledge')
            result.phase.artifact('EV-001', 'evidence')
            
            print(f"\nInvestigation valid: {result.is_valid}")
            print(f"Trace report: {result.get_report()}")
        
        print("\nInvestigation completed successfully!")
        
    except InvestigationWorkflowError as e:
        print(f"\nInvestigation failed: {e}")

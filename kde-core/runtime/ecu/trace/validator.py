"""
TraceValidator - Validates investigation traces

Validates that investigations have the required trace artifacts.
Rejects investigations without TRACE-INIT and TRACE-COMPLETE.

Part of INV-014 trace enforcement implementation.
"""

import os
import re
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from enum import Enum

from .manager import Trace, TraceType


class ValidationStatus(Enum):
    """Validation result status."""
    VALID = "valid"
    INVALID = "invalid"
    REJECTED = "rejected"
    INCOMPLETE = "incomplete"


@dataclass
class ValidationError:
    """A single validation error."""
    rule: str
    code: str
    message: str
    severity: str = "error"  # 'error', 'warning', 'info'
    
    def to_dict(self) -> Dict[str, str]:
        return {
            'rule': self.rule,
            'code': self.code,
            'message': self.message,
            'severity': self.severity,
        }


@dataclass
class ValidationResult:
    """Result of trace validation."""
    valid: bool
    status: ValidationStatus
    errors: List[ValidationError] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    trace_coverage: float = 0.0
    expected_phases: int = 0
    found_phases: int = 0
    
    def __post_init__(self):
        # Ensure valid matches status
        if self.status in (ValidationStatus.REJECTED, ValidationStatus.INVALID):
            self.valid = False
    
    def add_error(self, rule: str, code: str, message: str, 
                  severity: str = "error") -> None:
        """Add a validation error."""
        self.errors.append(ValidationError(
            rule=rule, code=code, message=message, severity=severity
        ))
        if severity == "error":
            self.valid = False
            if self.status == ValidationStatus.VALID:
                self.status = ValidationStatus.INVALID
    
    def add_warning(self, message: str) -> None:
        """Add a validation warning."""
        self.warnings.append(message)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            'valid': self.valid,
            'status': self.status.value,
            'errors': [e.to_dict() for e in self.errors],
            'warnings': self.warnings,
            'trace_coverage': self.trace_coverage,
            'expected_phases': self.expected_phases,
            'found_phases': self.found_phases,
        }


class TraceValidator:
    """
    Validates investigation traces for compliance.
    
    Enforces:
    1. TRACE-INIT must exist
    2. All expected phases must have traces
    3. TRACE-COMPLETE must exist
    4. Trace chain integrity must be maintained
    
    Usage:
        validator = TraceValidator()
        result = validator.validate(investigation_path)
        
        if not result.valid:
            print(f"Rejected: {result.errors}")
    """
    
    def __init__(self, expected_phases: int = 4):
        """
        Initialize TraceValidator.
        
        Args:
            expected_phases: Expected number of phase traces (default: 4)
        """
        self.expected_phases = expected_phases
    
    def validate(self, investigation_path: str) -> ValidationResult:
        """
        Validate traces for an investigation.
        
        Args:
            investigation_path: Path to investigation directory
            
        Returns:
            ValidationResult with validation status
        """
        traces = self._load_traces(investigation_path)
        return self.validate_traces(traces)
    
    def validate_traces(self, traces: List[Trace]) -> ValidationResult:
        """
        Validate a list of traces.
        
        Args:
            traces: List of Trace objects
            
        Returns:
            ValidationResult with validation status
        """
        result = ValidationResult(
            valid=True,
            status=ValidationStatus.VALID,
            expected_phases=self.expected_phases,
        )
        
        # Rule 1: TRACE-INIT must exist
        init_trace = self._find_trace(traces, TraceType.INIT)
        if not init_trace:
            result.status = ValidationStatus.REJECTED
            result.add_error(
                rule="TRACE-INIT",
                code="E001",
                message="TRACE-INIT not found - investigation rejected"
            )
            return result
        
        # Rule 2: TRACE-COMPLETE must exist
        complete_trace = self._find_trace(traces, TraceType.COMPLETE)
        if not complete_trace:
            result.status = ValidationStatus.INCOMPLETE
            result.add_error(
                rule="TRACE-COMPLETE",
                code="E002", 
                message="TRACE-COMPLETE not found - investigation incomplete"
            )
            return result
        
        # Rule 3: Check phase traces
        phase_traces = self._find_traces(traces, TraceType.PHASE)
        result.found_phases = len(phase_traces)
        
        if len(phase_traces) < self.expected_phases:
            result.add_warning(
                f"Missing phase traces: {len(phase_traces)}/{self.expected_phases}"
            )
        
        # Rule 4: Validate trace chain
        chain_valid = self._validate_chain(traces)
        if not chain_valid:
            result.add_error(
                rule="TRACE-CHAIN",
                code="E003",
                message="Trace chain broken - parent references invalid"
            )
        
        # Rule 5: Check trace order (INIT before PHASE before COMPLETE)
        order_valid = self._validate_order(traces)
        if not order_valid:
            result.add_error(
                rule="TRACE-ORDER",
                code="E004",
                message="Trace order invalid - INIT must come first, COMPLETE last"
            )
        
        # Calculate trace coverage
        if self.expected_phases > 0:
            result.trace_coverage = len(phase_traces) / self.expected_phases
        
        return result
    
    def _load_traces(self, investigation_path: str) -> List[Trace]:
        """Load traces from investigation directory."""
        traces = []
        
        trace_file = os.path.join(investigation_path, "TRACE.md")
        if not os.path.exists(trace_file):
            return traces
        
        with open(trace_file, 'r') as f:
            content = f.read()
        
        # Parse traces from file
        # Format: TRACE-TYPE:\n  trace_id: ...
        current_trace = None
        current_data = {}
        current_type = None
        
        for line in content.split('\n'):
            if line.startswith('TRACE-'):
                # Save previous trace
                if current_trace and current_type:
                    traces.append(Trace(
                        trace_id=current_trace,
                        trace_type=current_type,
                        data=current_data
                    ))
                
                current_type = line.rstrip(':')
                current_trace = None
                current_data = {}
            elif line.startswith('  trace_id:'):
                current_trace = line.split(':', 1)[1].strip()
            elif ':' in line and line.startswith('  '):
                key, value = line.split(':', 1)
                key = key.strip()
                value = value.strip()
                if value and value != 'None':
                    try:
                        current_data[key] = eval(value) if value in ('True', 'False', 'None') else value
                    except:
                        current_data[key] = value
        
        # Save last trace
        if current_trace and current_type:
            traces.append(Trace(
                trace_id=current_trace,
                trace_type=current_type,
                data=current_data
            ))
        
        return traces
    
    def _find_trace(self, traces: List[Trace], 
                    trace_type: TraceType) -> Optional[Trace]:
        """Find first trace of given type."""
        for trace in traces:
            if trace.trace_type == trace_type.value:
                return trace
        return None
    
    def _find_traces(self, traces: List[Trace], 
                     trace_type: TraceType) -> List[Trace]:
        """Find all traces of given type."""
        return [t for t in traces if t.trace_type == trace_type.value]
    
    def _validate_chain(self, traces: List[Trace]) -> bool:
        """Validate that parent references are correct."""
        trace_ids = {t.trace_id for t in traces}
        
        for trace in traces:
            if trace.parent_trace:
                if trace.parent_trace not in trace_ids:
                    return False
        
        return True
    
    def _validate_order(self, traces: List[Trace]) -> bool:
        """Validate that traces are in correct order."""
        init_idx = -1
        complete_idx = -1
        first_phase_idx = -1
        last_phase_idx = -1
        
        for i, trace in enumerate(traces):
            if trace.trace_type == TraceType.INIT.value:
                if init_idx == -1:
                    init_idx = i
                elif i < init_idx:
                    return False  # Another INIT before first
            elif trace.trace_type == TraceType.PHASE.value:
                if first_phase_idx == -1:
                    first_phase_idx = i
                last_phase_idx = i
            elif trace.trace_type == TraceType.COMPLETE.value:
                complete_idx = i
        
        # INIT must come before all PHASEs
        if init_idx > first_phase_idx >= 0:
            return False
        
        # COMPLETE must come after all PHASEs
        if complete_idx < last_phase_idx:
            return False
        
        return True
    
    def reject_if_no_init(self, traces: List[Trace]) -> ValidationResult:
        """
        Quick rejection check - returns immediately if no TRACE-INIT.
        
        This is the fastest path for rejecting invalid investigations.
        
        Args:
            traces: List of traces
            
        Returns:
            ValidationResult with REJECTED status if no TRACE-INIT
        """
        init_trace = self._find_trace(traces, TraceType.INIT)
        
        if not init_trace:
            return ValidationResult(
                valid=False,
                status=ValidationStatus.REJECTED,
                errors=[ValidationError(
                    rule="TRACE-INIT",
                    code="E001",
                    message="TRACE-INIT not found - investigation rejected"
                )]
            )
        
        return ValidationResult(valid=True, status=ValidationStatus.VALID)

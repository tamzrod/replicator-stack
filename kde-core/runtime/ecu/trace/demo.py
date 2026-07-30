"""
Trace Enforcement Demo

Demonstrates the mandatory trace layer implementation.
"""

from runtime.ecu.trace import TraceManager, TraceValidator, TraceEnforcer, TraceEnforcementError


def demo_trace_manager():
    """Demonstrate TraceManager usage."""
    print("=" * 60)
    print("DEMO: TraceManager")
    print("=" * 60)
    
    # Create manager
    tm = TraceManager("INV-DEMO", strict=True)
    print(f"\nCreated: {tm}")
    
    # Generate TRACE-INIT
    trace = tm.init(engine_id="KDE-ENGINE-003", engine_version="0.1.0")
    print(f"\nTRACE-INIT: {trace.trace_id}")
    print(f"  Engine: {trace.data['engine_id']}")
    print(f"  Session: {trace.data['session_uuid']}")
    
    # Trace phases
    tm.phase("analyzeevidence", inputs={"evidence_count": 14})
    print(f"\nTRACE-PHASE-1: analyzeevidence")
    
    tm.phase("validateknowledge", inputs={"knowledge_id": "KNOW-001"})
    print(f"TRACE-PHASE-2: validateknowledge")
    
    tm.phase("generateknowledgepipeline", outputs={"knowledge_count": 5})
    print(f"TRACE-PHASE-3: generateknowledgepipeline")
    
    tm.phase("generatereport", outputs={"report_id": "REPORT-001"})
    print(f"TRACE-PHASE-4: generatereport")
    
    # Trace artifact
    tm.artifact("KNOW-001", "knowledge")
    print(f"\nTRACE-ARTIFACT: KNOW-001")
    
    # Complete
    tm.complete(summary={"outcome": "success", "duration_ms": 45000})
    print(f"\nTRACE-COMPLETE: Investigation complete")
    
    # Validate
    result = tm.validate()
    print(f"\nValidation: {result.status.value}")
    print(f"Valid: {result.valid}")
    print(f"Trace coverage: {result.trace_coverage * 100:.0f}%")


def demo_rejection():
    """Demonstrate rejection of investigation without traces."""
    print("\n" + "=" * 60)
    print("DEMO: Rejection Without Traces")
    print("=" * 60)
    
    # Create validator
    validator = TraceValidator(expected_phases=4)
    
    # Try to validate empty traces
    result = validator.validate_traces([])
    
    print(f"\nEmpty traces validation:")
    print(f"  Status: {result.status.value}")
    print(f"  Valid: {result.valid}")
    for error in result.errors:
        print(f"  Error: {error.message}")


def demo_enforcer():
    """Demonstrate TraceEnforcer integration."""
    print("\n" + "=" * 60)
    print("DEMO: TraceEnforcer")
    print("=" * 60)
    
    # Create enforcer
    enforcer = TraceEnforcer()
    
    # Pre-investigation (generates TRACE-INIT)
    enforcer.pre_investigation("INV-TEST", "KDE-ENGINE-003")
    
    # Trace phases
    enforcer.trace_phase("analyzeevidence", inputs={"count": 10})
    enforcer.trace_phase("validateknowledge")
    enforcer.trace_phase("generateknowledgepipeline")
    enforcer.trace_phase("generatereport")
    
    # Post-investigation (generates TRACE-COMPLETE)
    result = enforcer.post_investigation({"outcome": "success"})
    
    print(f"\nInvestigation complete:")
    print(f"  Status: {result.status.value}")
    print(f"  Valid: {result.valid}")
    
    # Get report
    report = enforcer.get_trace_report()
    print(f"\nTrace Report:")
    print(f"  Investigation: {report['investigation_id']}")
    print(f"  Phases: {report['phase_count']}")
    print(f"  Total traces: {report['total_traces']}")


def demo_enforcer_rejection():
    """Demonstrate enforcer rejecting incomplete investigation."""
    print("\n" + "=" * 60)
    print("DEMO: Enforcer Rejection")
    print("=" * 60)
    
    # Try to complete without TRACE-INIT
    enforcer = TraceEnforcer()
    
    try:
        # This should fail - no pre_investigation called
        result = enforcer.post_investigation()
        print(f"Result: {result}")
    except TraceEnforcementError as e:
        print(f"\nTraceEnforcementError (expected): {e}")


def main():
    """Run all demos."""
    print("\n" + "#" * 60)
    print("# TRACE ENFORCEMENT IMPLEMENTATION DEMO")
    print("#" * 60)
    
    demo_trace_manager()
    demo_rejection()
    demo_enforcer()
    demo_enforcer_rejection()
    
    print("\n" + "#" * 60)
    print("# DEMO COMPLETE")
    print("#" * 60)
    print("\nSummary:")
    print("  - TraceManager generates mandatory traces")
    print("  - TraceValidator rejects invalid investigations")
    print("  - TraceEnforcer integrates with ECU")
    print("  - TRACE-INIT required before investigation")
    print("  - TRACE-COMPLETE required to complete")
    print("  - Missing traces = investigation REJECTED")


if __name__ == "__main__":
    main()

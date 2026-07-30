"""
Runtime ECU (Execution Control Unit)

Main orchestrator for the KDE Runtime ECU.
"""

import os
import uuid
from typing import Dict, List, Optional, Any
from datetime import datetime
from dataclasses import dataclass, field

from .models import (
    ECUState, ExecutionRequest, ExecutionPlan, ExecutionMode,
    EngineSelection, SeedSelection, EngineResult, AggregatedResult,
    CapabilityType, ConsensusStrategy, PolicyViolationResult
)
from .registry import EngineRegistry, SeedRegistry
from .resolver import CapabilityResolver
from .planner import ExecutionPlanner
from .policy import PolicyLayer
from .consensus import ConsensusManager
from .aggregator import ResultAggregator
from ..principles_enforcer import (
    FivePrinciplesEnforcer, 
    PrincipleViolationError, 
    PrincipleType,
    EnforcementResult
)
from ..file_boundary_guard import (
    FileBoundaryGuard,
    BoundaryCheckResult,
    ViolationSeverity,
    create_guard
)


@dataclass
class ECUInitializationResult:
    """Result of ECU initialization."""
    success: bool
    engines_registered: int = 0
    seeds_registered: int = 0
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


@dataclass
class ECUExecutionResult:
    """Result of ECU execution."""
    request_id: str
    plan_id: Optional[str] = None
    success: bool = False
    blocked: bool = False
    policy_violations: List[str] = field(default_factory=list)
    error_message: str = ""
    aggregated_result: Optional[AggregatedResult] = None
    plan_summary: Optional[Dict[str, Any]] = None


class RuntimeECU:
    """
    Runtime Execution Control Unit (ECU).
    
    The ECU is the runtime orchestration layer responsible for:
    - Capability Analysis
    - Runtime Policy Enforcement
    - Five Core Principles Enforcement (SEED-001)
    - Engine Registry
    - Seed Registry
    - Capability Resolution
    - Engine Selection
    - Seed Selection
    - Execution Planning
    - Consensus Coordination
    - Result Aggregation
    
    The ECU SHALL NOT execute engineering reasoning.
    Reasoning belongs exclusively to Engines.
    
    FIVE CORE PRINCIPLES (ENFORCED):
    1. No Auto-Continuation - Require human authorization
    2. No Self-Approval - Block AI approval transitions
    3. No Self-Promotion - Block AI promotion transitions
    4. Distinguish Evidence - Classify content by evidence level
    5. Evidence-Based Changes - Require evidence for claims
    """
    
    def __init__(self, kde_root: str):
        """
        Initialize the Runtime ECU.
        
        Args:
            kde_root: Root path to the KDE runtime directory
        """
        self.kde_root = kde_root
        
        # State
        self.state = ECUState()
        
        # Components
        self.engine_registry = EngineRegistry(kde_root)
        self.seed_registry = SeedRegistry(kde_root)
        self.capability_resolver = CapabilityResolver()
        self.execution_planner = ExecutionPlanner()
        self.policy_layer = PolicyLayer(
            self.engine_registry,
            self.seed_registry,
            kde_root
        )
        self.consensus_manager = ConsensusManager()
        self.result_aggregator = ResultAggregator()
        
        # Five Core Principles Enforcer (SEED-001)
        self.principles_enforcer = FivePrinciplesEnforcer(kde_root)
        
        # File Boundary Guard - Active enforcement of file boundaries
        self.file_boundary_guard = create_guard(kde_root)
        
        # Execution history
        self._execution_history: List[ECUExecutionResult] = []
    
    def check_file_operation(self, operation: str, path: str) -> BoundaryCheckResult:
        """
        Check a file operation against boundary rules.
        
        Args:
            operation: The operation type (create, write, delete, etc.)
            path: The file path to check
            
        Returns:
            BoundaryCheckResult with violation details
        """
        return self.file_boundary_guard.check_operation(operation, path)
    
    def is_file_allowed(self, operation: str, path: str) -> tuple[bool, str]:
        """
        Quick check if a file operation is allowed.
        
        Args:
            operation: The operation type
            path: The file path
            
        Returns:
            Tuple of (allowed, reason)
        """
        return self.file_boundary_guard.is_allowed(path, operation)
    
    def format_violation_message(self, result: BoundaryCheckResult) -> str:
        """
        Format a violation message for user presentation.
        
        Args:
            result: The boundary check result
            
        Returns:
            Formatted violation message
        """
        return self.file_boundary_guard.format_violation_message(result)
    
    def initialize(self) -> ECUInitializationResult:
        """
        Initialize the ECU and discover all engines and seeds.
        
        Returns:
            ECUInitializationResult
        """
        errors = []
        warnings = []
        
        try:
            # Discover engines
            engines = self.engine_registry.discover()
            self.state.engines_registered = len(engines)
            
            if len(engines) == 0:
                warnings.append("No engines discovered")
            
            # Discover seeds
            seeds = self.seed_registry.discover()
            self.state.seeds_registered = len(seeds)
            
            if len(seeds) == 0:
                warnings.append("No seeds discovered")
            
            # Validate registries
            for engine in engines:
                violation = self.policy_layer.validate_engine(engine)
                if violation.violated:
                    warnings.append(
                        f"Engine {engine.engine_id} has policy warnings"
                    )
            
            for seed in seeds:
                violation = self.policy_layer.validate_seed(seed)
                if violation.violated:
                    warnings.append(
                        f"Seed {seed.seed_id} has policy warnings"
                    )
            
            # Update state
            self.state.initialized = True
            self.state.last_initialization = datetime.now()
            
            return ECUInitializationResult(
                success=True,
                engines_registered=len(engines),
                seeds_registered=len(seeds),
                warnings=warnings
            )
            
        except Exception as e:
            errors.append(str(e))
            self.state.initialization_errors = errors
            return ECUInitializationResult(
                success=False,
                errors=errors
            )
    
    def analyze_capabilities(
        self,
        request: ExecutionRequest
    ) -> Dict[str, Any]:
        """
        Analyze capabilities required for a request.
        
        Args:
            request: Execution request
        
        Returns:
            Capability analysis report
        """
        return {
            "request_id": request.request_id,
            "required_capabilities": [c.value for c in request.required_capabilities],
            "keywords": request.keywords,
            "preferred_seeds": request.preferred_seeds,
            "consensus_mode": request.consensus_mode.value if request.consensus_mode else None,
            "analysis_timestamp": datetime.now().isoformat()
        }
    
    def resolve_capabilities(
        self,
        request: ExecutionRequest
    ) -> Dict[str, Any]:
        """
        Resolve capabilities to engines and seeds.
        
        Args:
            request: Execution request
        
        Returns:
            Resolution report
        """
        # Get all engines and seeds
        engines = self.engine_registry.get_all_engines()
        seeds = self.seed_registry.get_all_seeds()
        
        # Resolve
        engine_selections = self.capability_resolver.resolve(
            request, engines, seeds
        )
        
        seed_selections = self.capability_resolver.select_seeds(
            engine_selections,
            request.preferred_seeds,
            seeds
        )
        
        # Generate report
        report = self.capability_resolver.generate_resolution_report(
            request, engine_selections, seed_selections
        )
        
        return report
    
    def create_execution_plan(
        self,
        request: ExecutionRequest
    ) -> ECUExecutionResult:
        """
        Create an execution plan for a request.
        
        Args:
            request: Execution request
        
        Returns:
            ECUExecutionResult
        """
        result = ECUExecutionResult(request_id=request.request_id)
        
        try:
            # Resolve capabilities
            engines = self.engine_registry.get_all_engines()
            seeds = self.seed_registry.get_all_seeds()
            
            engine_selections = self.capability_resolver.resolve(
                request, engines, seeds
            )
            
            seed_selections = self.capability_resolver.select_seeds(
                engine_selections,
                request.preferred_seeds,
                seeds
            )
            
            if not engine_selections:
                result.error_message = "No engines match required capabilities"
                return result
            
            # Create plan
            plan = self.execution_planner.create_plan(
                request, engine_selections, seed_selections
            )
            
            # Validate plan
            self.execution_planner.validate_plan(plan)
            
            # Validate against policy
            policy_result = self.policy_layer.validate_execution_plan(plan)
            
            if policy_result.violated:
                result.blocked = policy_result.blocked
                result.policy_violations = [
                    f"{v.value}: {d}"
                    for v, d in zip(policy_result.violations, policy_result.details)
                ]
                result.error_message = "Policy violations detected"
                return result
            
            # Success
            result.success = True
            result.plan_id = plan.plan_id
            result.plan_summary = self.execution_planner.get_plan_summary(plan)
            
            return result
            
        except Exception as e:
            result.error_message = str(e)
            return result
    
    def execute_plan(
        self,
        plan: ExecutionPlan,
        execution_fn: Optional[callable] = None
    ) -> AggregatedResult:
        """
        Execute an established plan.
        
        Note: This is a stub. Actual execution requires Laboratory integration.
        The ECU coordinates execution but does not perform reasoning.
        
        Args:
            plan: Execution plan
            execution_fn: Optional function to execute engines
        
        Returns:
            AggregatedResult
        """
        # Generate stub results for demonstration
        results = []
        
        for step in plan.steps:
            if step.engine:
                results.append(EngineResult(
                    engine_id=step.engine.engine_id,
                    engine_version=step.engine.version,
                    step_id=step.step_id,
                    success=True,
                    outputs={"step": step.step_id, "engine": step.engine.codename},
                    execution_time_ms=100.0,
                    provenance={"engine": step.engine.engine_id}
                ))
        
        # Coordinate consensus if required
        consensus_result = None
        has_consensus = any(s.consensus_required for s in plan.steps)
        
        if has_consensus and plan.consensus_strategy:
            engine_metadata = {
                e.engine_id: e
                for e in self.engine_registry.get_all_engines()
            }
            consensus_result = self.consensus_manager.coordinate(
                results,
                plan.consensus_strategy,
                engine_metadata
            )
        
        # Aggregate results
        aggregated = self.result_aggregator.aggregate(
            plan.request_id,
            plan,
            results,
            consensus_result
        )
        
        return aggregated
    
    def execute_with_auto_selection(
        self,
        request: ExecutionRequest,
        execution_fn: Optional[callable] = None
    ) -> AggregatedResult:
        """
        Execute a request with automatic engine and seed selection.
        
        This is the primary execution method that:
        1. Automatically resolves the best engine for the request's capabilities
        2. Automatically selects compatible seeds
        3. Creates an execution plan
        4. Executes the plan
        
        Args:
            request: Execution request with required_capabilities and keywords
            execution_fn: Optional function to execute engines
            
        Returns:
            AggregatedResult from plan execution
            
        Raises:
            NoSuitableEngineError: If no engine matches the required capabilities
        """
        # Step 1: Get available engines and seeds
        engines = self.engine_registry.get_active_engines()
        seeds = self.seed_registry.get_active_seeds()
        
        # Step 2: Auto-resolve engine selection
        engine_selections = self.capability_resolver.resolve(request, engines, seeds)
        
        if not engine_selections:
            # Fallback to default engine (GAMMA - most capable)
            default_engine = self.engine_registry.get_engine("KDE-ENGINE-003")
            if default_engine:
                engine_selections = [EngineSelection(
                    engine=default_engine,
                    reason="default - no match found",
                    confidence=0.5
                )]
            else:
                raise RuntimeError("No suitable engine found and no default available")
        
        # Step 3: Auto-select compatible seeds
        seed_selections = self.capability_resolver.select_seeds(
            engine_selections,
            request.preferred_seeds,
            seeds
        )
        
        # Step 4: Create execution plan
        plan = self.execution_planner.create_plan(
            request,
            engine_selections,
            seed_selections
        )
        
        # Step 5: Execute the plan
        result = self.execute_plan(plan, execution_fn)
        
        return result
    
    def get_runtime_state(self) -> Dict[str, Any]:
        """
        Get current ECU runtime state.
        
        Returns:
            Runtime state dictionary
        """
        return {
            "initialized": self.state.initialized,
            "engines_registered": self.state.engines_registered,
            "seeds_registered": self.state.seeds_registered,
            "total_requests_processed": self.state.total_requests_processed,
            "total_plans_generated": self.state.total_plans_generated,
            "total_policy_violations": self.state.total_policy_violations,
            "last_initialization": (
                self.state.last_initialization.isoformat()
                if self.state.last_initialization else None
            ),
            "initialization_errors": self.state.initialization_errors,
            "engine_registry": self.engine_registry.get_registry_summary(),
            "seed_registry": self.seed_registry.get_registry_summary(),
            "policy_summary": self.policy_layer.get_policy_summary(),
            "consensus_summary": self.consensus_manager.get_consensus_summary(),
            "aggregation_summary": self.result_aggregator.get_aggregation_summary()
        }
    
    def get_execution_history(
        self,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Get recent execution history.
        
        Args:
            limit: Maximum number of records to return
        
        Returns:
            List of execution result summaries
        """
        history = self._execution_history[-limit:]
        
        return [
            {
                "request_id": r.request_id,
                "plan_id": r.plan_id,
                "success": r.success,
                "blocked": r.blocked,
                "error_message": r.error_message
            }
            for r in history
        ]
    
    # =========================================================================
    # FIVE CORE PRINCIPLES ENFORCEMENT (SEED-001)
    # =========================================================================
    
    def require_authorization(self, session_id: str) -> EnforcementResult:
        """
        Require human authorization for session continuation.
        
        Enforces Principle 1: No Auto-Continuation.
        
        Args:
            session_id: Unique session identifier
            
        Returns:
            EnforcementResult with authorization status
        """
        return self.principles_enforcer.require_continuation_authorization(session_id)
    
    def authorize_session(
        self, 
        session_id: str, 
        authorized_by: str = "human"
    ) -> EnforcementResult:
        """
        Authorize a session checkpoint.
        
        Args:
            session_id: Session to authorize
            authorized_by: Who is authorizing (must be human)
            
        Returns:
            EnforcementResult
        """
        return self.principles_enforcer.authorize_continuation(session_id, authorized_by)
    
    def check_state_transition(
        self,
        current_state: str,
        new_state: str,
        actor: str = "unknown"
    ) -> EnforcementResult:
        """
        Check if a state transition is allowed.
        
        Enforces Principle 2: No Self-Approval.
        
        Args:
            current_state: Current document state
            new_state: Desired new state
            actor: Who is making the transition
            
        Returns:
            EnforcementResult
        """
        return self.principles_enforcer.check_state_transition(
            current_state, new_state, actor
        )
    
    def check_promotion(
        self,
        current_state: str,
        new_state: str,
        destination: str = "knowledge",
        actor: str = "unknown"
    ) -> EnforcementResult:
        """
        Check if a promotion is allowed.
        
        Enforces Principle 3: No Self-Promotion.
        
        Args:
            current_state: Current state
            new_state: Desired promotion state
            destination: Where being promoted to
            actor: Who is promoting
            
        Returns:
            EnforcementResult
        """
        return self.principles_enforcer.check_promotion_transition(
            current_state, new_state, destination, actor
        )
    
    def check_content_evidence(self, content: str) -> EnforcementResult:
        """
        Check content for proper evidence distinction.
        
        Enforces Principle 4: Distinguish Evidence, Inference, and Hypothesis.
        
        Args:
            content: Content to check
            
        Returns:
            EnforcementResult with classification
        """
        return self.principles_enforcer.check_evidence_distinction(content)
    
    def check_claims_evidence(self, content: str) -> EnforcementResult:
        """
        Check claims in content for evidence backing.
        
        Enforces Principle 5: Evidence-Based Changes.
        
        Args:
            content: Content to check
            
        Returns:
            EnforcementResult
        """
        return self.principles_enforcer.check_claims(content)
    
    def enforce_principles(self, context: Dict[str, Any]) -> EnforcementResult:
        """
        Run all Five Core Principles enforcement checks.
        
        Args:
            context: Context containing content, states, actor, session_id
            
        Returns:
            Combined EnforcementResult
        """
        return self.principles_enforcer.enforce_all(context)
    
    def get_principles_status(self) -> Dict[str, Any]:
        """
        Get current Five Core Principles enforcement status.
        
        Returns:
            Status dictionary
        """
        report = self.principles_enforcer.get_enforcement_report()
        return {
            "enforcer_active": True,
            "seed_id": "SEED-001",
            "seed_name": "Genesis",
            "principles": [
                {"id": 1, "name": "No Auto-Continuation", "enforced": True},
                {"id": 2, "name": "No Self-Approval", "enforced": True},
                {"id": 3, "name": "No Self-Promotion", "enforced": True},
                {"id": 4, "name": "Distinguish Evidence", "enforced": True},
                {"id": 5, "name": "Evidence-Based Changes", "enforced": True},
            ],
            "checkpoint_summary": {
                "total": len(self.principles_enforcer.checkpoints),
                "authorized": sum(
                    1 for cp in self.principles_enforcer.checkpoints.values()
                    if cp.status.value == "authorized"
                )
            }
        }


def create_ecu(kde_root: str) -> RuntimeECU:
    """
    Create and initialize a Runtime ECU.
    
    Args:
        kde_root: Root path to the KDE runtime directory
    
    Returns:
        Initialized RuntimeECU instance
    """
    ecu = RuntimeECU(kde_root)
    result = ecu.initialize()
    
    if not result.success:
        raise RuntimeError(
            f"ECU initialization failed: {', '.join(result.errors)}"
        )
    
    return ecu

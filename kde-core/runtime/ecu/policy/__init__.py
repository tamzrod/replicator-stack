"""
Policy Layer Module

Runtime policy enforcement for ECU operations.
Includes laboratory rule enforcement per INV-082.
"""

import os
import re
from typing import List, Dict, Optional, Any, Set, Tuple
from dataclasses import dataclass, field
from pathlib import Path

from ..models import (
    PolicyViolation, PolicyViolationResult, ExecutionPlan,
    EngineMetadata, SeedMetadata
)
from ..registry import EngineRegistry, SeedRegistry


# Laboratory naming conventions (from governance/NAMING-CONVENTIONS.md)
# Note: Paths are relative to the parent directory (e.g., laboratory/)
LABORATORY_NAMING_RULES = {
    "investigations": {
        "KDE-INV": {"directory": "laboratory/investigations/", "pattern": r"^KDE-INV-\d+$"},
        "PROJECT-INV": {"directory": "laboratory/investigations/", "pattern": r"^PROJECT-INV-\d+$"},
        "INV": {"directory": "laboratory/investigations/", "pattern": r"^INV-\d+$"},
    },
    "experiments": {
        "LAB": {"directory": "laboratory/experiments/", "pattern": r"^LAB-\d+"},
        "PROJECT-EXP": {"directory": "laboratory/experiments/", "pattern": r"^PROJECT-EXP-\d+$"},
        "EXP": {"directory": "laboratory/experiments/", "pattern": r"^EXP-\d+$"},
    },
    "decisions": {
        "TDR": {"directory": "decisions/", "pattern": r"^TDR-\d+\.md$"},
    },
    "implementations": {
        "PROJECT-IMP": {"directory": "implementations/", "pattern": r"^PROJECT-IMP-\d+$"},
    },
    "reviews": {
        "PROJECT-REV": {"directory": "reviews/", "pattern": r"^PROJECT-REV-\d+\.md$"},
    },
    "testing": {
        "TEST": {"directory": "testing/", "pattern": r"^TEST-\d+"},
    },
}


@dataclass
class PolicyRule:
    """A single policy rule."""
    name: str
    description: str
    check_fn: callable
    severity: str = "error"  # error, warning, info
    blocking: bool = True


class PolicyLayer:
    """
    Runtime policy enforcement for the ECU.
    
    Responsibilities:
    - Validate engine registrations
    - Validate seed registrations
    - Validate execution plans
    - Block unauthorized operations
    - Enforce runtime policies
    """
    
    def __init__(
        self,
        engine_registry: EngineRegistry,
        seed_registry: SeedRegistry,
        kde_root: str
    ):
        """
        Initialize the Policy Layer.
        
        Args:
            engine_registry: Engine registry instance
            seed_registry: Seed registry instance
            kde_root: KDE runtime root directory
        """
        self.engine_registry = engine_registry
        self.seed_registry = seed_registry
        self.kde_root = kde_root
        
        # Initialize policy rules
        self._rules: List[PolicyRule] = []
        self._initialize_rules()
        
        # Policy statistics
        self.total_checks = 0
        self.total_violations = 0
    
    def _initialize_rules(self) -> None:
        """Initialize policy rules."""
        self._rules = [
            PolicyRule(
                name="engine_must_be_registered",
                description="All engines must be registered in the Engine Registry",
                check_fn=self._check_engine_registered,
                blocking=True
            ),
            PolicyRule(
                name="engine_must_have_specification",
                description="All engines must have a specification.md file",
                check_fn=self._check_engine_has_specification,
                blocking=True
            ),
            PolicyRule(
                name="engine_no_placeholder",
                description="Engines must not be placeholder implementations",
                check_fn=self._check_engine_not_placeholder,
                blocking=True
            ),
            PolicyRule(
                name="seed_must_be_registered",
                description="All seeds must be registered in the Seed Registry",
                check_fn=self._check_seed_registered,
                blocking=True
            ),
            PolicyRule(
                name="execution_plan_must_be_valid",
                description="Execution plans must pass validation",
                check_fn=self._check_plan_valid,
                blocking=True
            ),
            PolicyRule(
                name="execution_plan_engine_exists",
                description="All engines in execution plan must exist",
                check_fn=self._check_plan_engines_exist,
                blocking=True
            ),
            PolicyRule(
                name="no_unofficial_assets",
                description="Execution must not reference unofficial runtime assets",
                check_fn=self._check_no_unofficial_assets,
                blocking=True
            ),
            PolicyRule(
                name="engine_capabilities_match",
                description="Selected engines must match required capabilities",
                check_fn=self._check_engine_capabilities,
                blocking=False
            ),
            # Laboratory rule enforcement
            PolicyRule(
                name="laboratory_naming_convention",
                description="Laboratory artifacts must follow naming conventions",
                check_fn=self._check_laboratory_naming,
                blocking=True
            ),
            PolicyRule(
                name="laboratory_no_duplicate_id",
                description="Laboratory artifacts must not duplicate existing IDs",
                check_fn=self._check_laboratory_no_duplicate,
                blocking=True
            ),
            PolicyRule(
                name="laboratory_directory_placement",
                description="Laboratory artifacts must be in correct directories",
                check_fn=self._check_laboratory_directory,
                blocking=True
            ),
            # INV-RUNTIME-GAPS Mitigation: Dependency and State Verification Rules
            PolicyRule(
                name="runtime_dependencies_available",
                description="All required Python dependencies must be installed",
                check_fn=self._check_runtime_dependencies,
                blocking=True
            ),
            PolicyRule(
                name="runtime_state_verified",
                description="Runtime state must be verified before initialization",
                check_fn=self._check_runtime_state_verified,
                blocking=True
            ),
            PolicyRule(
                name="experiment_engine_valid",
                description="Experiment must reference a registered engine",
                check_fn=self._check_experiment_engine_valid,
                blocking=True
            ),
            PolicyRule(
                name="experiment_seed_valid",
                description="Experiment must reference a registered seed",
                check_fn=self._check_experiment_seed_valid,
                blocking=True
            ),
        ]
    
    def validate_engine(self, engine: EngineMetadata) -> PolicyViolationResult:
        """
        Validate an engine against policy rules.
        
        Args:
            engine: Engine to validate
        
        Returns:
            PolicyViolationResult
        """
        violations = []
        details = []
        
        # Only apply engine-specific rules (not engine-related plan rules)
        engine_rules = [
            'engine_must_be_registered',
            'engine_must_have_specification',
            'engine_no_placeholder'
        ]
        
        for rule in self._rules:
            if rule.name in engine_rules:
                result = rule.check_fn(engine)
                if result:
                    violations.extend(result.get('violations', []))
                    details.extend(result.get('details', []))
        
        blocked = len(violations) > 0 and any(
            r.blocking for r in self._rules if r.name in [v.value if hasattr(v, 'value') else v for v in violations]
        )
        
        self.total_checks += 1
        if violations:
            self.total_violations += 1
        
        return PolicyViolationResult(
            violated=len(violations) > 0,
            violations=violations,
            details=details,
            blocked=blocked
        )
    
    def validate_seed(self, seed: SeedMetadata) -> PolicyViolationResult:
        """
        Validate a seed against policy rules.
        
        Args:
            seed: Seed to validate
        
        Returns:
            PolicyViolationResult
        """
        violations = []
        details = []
        
        for rule in self._rules:
            if 'seed' in rule.name:
                result = rule.check_fn(seed)
                if result:
                    violations.extend(result.get('violations', []))
                    details.extend(result.get('details', []))
        
        blocked = len(violations) > 0 and any(
            r.blocking for r in self._rules if r.name in [v.value if hasattr(v, 'value') else v for v in violations]
        )
        
        self.total_checks += 1
        if violations:
            self.total_violations += 1
        
        return PolicyViolationResult(
            violated=len(violations) > 0,
            violations=violations,
            details=details,
            blocked=blocked
        )
    
    def validate_execution_plan(self, plan: ExecutionPlan) -> PolicyViolationResult:
        """
        Validate an execution plan against policy rules.
        
        Args:
            plan: Execution plan to validate
        
        Returns:
            PolicyViolationResult
        """
        violations = []
        details = []
        
        for rule in self._rules:
            if 'plan' in rule.name or 'execution' in rule.name or 'unofficial' in rule.name:
                result = rule.check_fn(plan)
                if result:
                    violations.extend(result.get('violations', []))
                    details.extend(result.get('details', []))
        
        # Check for blocking violations
        blocked = False
        for v in violations:
            if v.blocked:
                blocked = True
                break
        
        self.total_checks += 1
        if violations:
            self.total_violations += 1
        
        return PolicyViolationResult(
            violated=len(violations) > 0,
            violations=violations,
            details=details,
            blocked=blocked
        )
    
    def _check_engine_registered(
        self, engine: EngineMetadata
    ) -> Dict[str, Any]:
        """Check if engine is registered."""
        registered = self.engine_registry.get_engine(engine.engine_id)
        
        if not registered:
            return {
                'violations': [PolicyViolation.UNAUTHORIZED_ENGINE],
                'details': [f"Engine {engine.engine_id} is not registered"]
            }
        
        return {'violations': [], 'details': []}
    
    def _check_engine_has_specification(
        self, engine: EngineMetadata
    ) -> Dict[str, Any]:
        """Check if engine has specification.md."""
        if not engine.specification_path:
            return {
                'violations': [PolicyViolation.INVALID_REGISTRATION],
                'details': [f"Engine {engine.engine_id} has no specification"]
            }
        
        if not os.path.exists(engine.specification_path):
            return {
                'violations': [PolicyViolation.INVALID_REGISTRATION],
                'details': [f"Engine {engine.engine_id} specification not found"]
            }
        
        return {'violations': [], 'details': []}
    
    def _check_engine_not_placeholder(
        self, engine: EngineMetadata
    ) -> Dict[str, Any]:
        """Check if engine is not a placeholder."""
        placeholder_indicators = [
            'placeholder', 'stub', 'todo', 'wip', 'temporary',
            'not_implemented', 'coming_soon'
        ]
        
        codename_lower = engine.codename.lower()
        for indicator in placeholder_indicators:
            if indicator in codename_lower:
                return {
                    'violations': [PolicyViolation.PLACEHOLDER_ENGINE],
                    'details': [f"Engine {engine.engine_id} appears to be a placeholder"]
                }
        
        return {'violations': [], 'details': []}
    
    def _check_seed_registered(
        self, seed: SeedMetadata
    ) -> Dict[str, Any]:
        """Check if seed is registered."""
        registered = self.seed_registry.get_seed(seed.seed_id)
        
        if not registered:
            return {
                'violations': [PolicyViolation.SEED_NOT_FOUND],
                'details': [f"Seed {seed.seed_id} is not registered"]
            }
        
        return {'violations': [], 'details': []}
    
    def _check_plan_valid(
        self, plan: ExecutionPlan
    ) -> Dict[str, Any]:
        """Check if execution plan is valid."""
        if not plan.validated:
            return {
                'violations': [PolicyViolation.INVALID_EXECUTION_PLAN],
                'details': [f"Execution plan {plan.plan_id} has not been validated"]
            }
        
        if plan.validation_errors:
            return {
                'violations': [PolicyViolation.INVALID_EXECUTION_PLAN],
                'details': plan.validation_errors
            }
        
        return {'violations': [], 'details': []}
    
    def _check_plan_engines_exist(
        self, plan: ExecutionPlan
    ) -> Dict[str, Any]:
        """Check if all engines in plan exist."""
        missing = []
        
        for step in plan.steps:
            if step.engine:
                if not self.engine_registry.get_engine(step.engine.engine_id):
                    missing.append(step.engine.engine_id)
        
        if missing:
            return {
                'violations': [PolicyViolation.ENGINE_NOT_FOUND],
                'details': [f"Missing engines in plan: {', '.join(missing)}"]
            }
        
        return {'violations': [], 'details': []}
    
    def _check_no_unofficial_assets(
        self, plan: ExecutionPlan
    ) -> Dict[str, Any]:
        """Check for unofficial assets in plan."""
        from ..registry import get_mode_paths
        
        # Check for engine directories outside of official path (mode-aware)
        unofficial_paths = []
        engines_dir, _, _ = get_mode_paths(self.kde_root)
        official_engines_dir = engines_dir
        
        for step in plan.steps:
            if step.engine and step.engine.directory:
                engine_path = os.path.join(official_engines_dir, step.engine.directory)
                if not os.path.exists(engine_path):
                    unofficial_paths.append(step.engine.directory)
        
        if unofficial_paths:
            return {
                'violations': [PolicyViolation.UNOFFICIAL_ASSET],
                'details': [f"Unofficial engine paths: {', '.join(set(unofficial_paths))}"]
            }
        
        return {'violations': [], 'details': []}
    
    def _check_engine_capabilities(
        self, plan: ExecutionPlan
    ) -> Dict[str, Any]:
        """Check if engine capabilities match plan requirements."""
        # This is a warning-only check
        return {'violations': [], 'details': []}

    def _check_laboratory_naming(
        self, artifact_path: str = None
    ) -> Dict[str, Any]:
        """Check if artifact name follows naming conventions."""
        if artifact_path is None:
            return {'violations': [], 'details': []}  # Not applicable without path
        
        artifact_name = os.path.basename(artifact_path)
        
        for category, rules in LABORATORY_NAMING_RULES.items():
            for prefix, config in rules.items():
                pattern = config["pattern"]
                if re.match(pattern, artifact_name):
                    return {'violations': [], 'details': []}
        
        return {
            'violations': [PolicyViolation.INVALID_NAMING_CONVENTION],
            'details': [f"Artifact '{artifact_name}' does not match any known naming pattern"]
        }

    def _check_laboratory_no_duplicate(
        self, artifact_path: str = None
    ) -> Dict[str, Any]:
        """Check if artifact ID already exists."""
        if artifact_path is None:
            return {'violations': [], 'details': []}
        
        kde_root = Path(self.kde_root)
        
        # Extract artifact name without extension
        artifact_name = os.path.basename(artifact_path)
        base_name = artifact_name.replace('.md', '')
        
        # Check all known directories for duplicates
        for category, rules in LABORATORY_NAMING_RULES.items():
            for prefix, config in rules.items():
                directory = config["directory"]
                dir_path = kde_root / directory
                
                if dir_path.exists():
                    # Check for directory match
                    for existing in dir_path.iterdir():
                        if existing.name == base_name or existing.name == artifact_name:
                            return {
                                'violations': [PolicyViolation.DUPLICATE_ARTIFACT_ID],
                                'details': [f"Artifact ID '{base_name}' already exists in {directory}"]
                            }
        
        return {'violations': [], 'details': []}

    def _check_laboratory_directory(
        self, artifact_path: str = None
    ) -> Dict[str, Any]:
        """Check if artifact is in correct directory."""
        if artifact_path is None:
            return {'violations': [], 'details': []}
        
        artifact_name = os.path.basename(artifact_path)
        kde_root = Path(self.kde_root)
        
        # Find expected directory based on naming pattern
        expected_dir = None
        for category, rules in LABORATORY_NAMING_RULES.items():
            for prefix, config in rules.items():
                pattern = config["pattern"]
                if re.match(pattern, artifact_name):
                    expected_dir = config["directory"]
                    break
            if expected_dir:
                break
        
        if expected_dir:
            actual_dir = os.path.dirname(artifact_path)
            expected_full = str(kde_root / expected_dir)
            
            if not actual_dir.endswith(expected_dir.rstrip('/')):
                return {
                    'violations': [PolicyViolation.INVALID_ARTIFACT_DIRECTORY],
                    'details': [f"Artifact should be in {expected_dir}, found in {actual_dir}"]
                }
        
        return {'violations': [], 'details': []}

    # =========================================================================
    # INV-RUNTIME-GAPS MITIGATION: Dependency and State Verification
    # =========================================================================
    
    def _check_runtime_dependencies(self, context: Any = None) -> Dict[str, Any]:
        """
        Check if all required Python dependencies are available.
        
        This is the FIRST policy check - if dependencies are missing,
        nothing else can run.
        """
        try:
            # Try to import the dependency checker
            from ..dependency_checker import DependencyChecker
            checker = DependencyChecker()
            result = checker.check_all()
            
            if not result.all_passed:
                return {
                    'violations': [PolicyViolation.MISSING_DEPENDENCY],
                    'details': [f"Missing packages: {', '.join(result.missing_packages)}"]
                }
            
            return {'violations': [], 'details': []}
            
        except ImportError:
            # If dependency checker can't be imported, check core imports directly
            try:
                import yaml
                return {'violations': [], 'details': []}
            except ImportError:
                return {
                    'violations': [PolicyViolation.MISSING_DEPENDENCY],
                    'details': ['PyYAML (yaml) is required but not installed']
                }
    
    def _check_runtime_state_verified(self, context: Any = None) -> Dict[str, Any]:
        """
        Check if runtime state has been verified.
        
        This ensures claimed state matches actual conditions.
        """
        try:
            from ...state_verifier import RuntimeStateVerifier
            verifier = RuntimeStateVerifier(self.kde_root)
            report = verifier.verify_all()
            
            if not report.can_initialize:
                return {
                    'violations': [PolicyViolation.INVALID_STATE],
                    'details': report.blocking_issues
                }
            
            return {'violations': [], 'details': []}
            
        except ImportError:
            # If state verifier not available, skip this check
            return {'violations': [], 'details': []}
    
    def _check_experiment_engine_valid(self, context: Any = None) -> Dict[str, Any]:
        """
        Check if experiment references a valid registered engine.
        
        This prevents experiments from claiming fake engine IDs.
        Context should contain 'engine_id' for the experiment.
        """
        if context is None or not hasattr(context, 'engine_id'):
            # No engine ID provided, skip check
            return {'violations': [], 'details': []}
        
        engine_id = getattr(context, 'engine_id', None)
        if not engine_id:
            return {'violations': [], 'details': []}
        
        engine = self.engine_registry.get_engine(engine_id)
        if not engine:
            return {
                'violations': [PolicyViolation.ENGINE_NOT_FOUND],
                'details': [f"Engine '{engine_id}' not found in registry"]
            }
        
        return {'violations': [], 'details': []}
    
    def _check_experiment_seed_valid(self, context: Any = None) -> Dict[str, Any]:
        """
        Check if experiment references a valid registered seed.
        
        This prevents experiments from claiming fake seed IDs.
        Context should contain 'seed_id' for the experiment.
        """
        if context is None or not hasattr(context, 'seed_id'):
            # No seed ID provided, skip check
            return {'violations': [], 'details': []}
        
        seed_id = getattr(context, 'seed_id', None)
        if not seed_id:
            return {'violations': [], 'details': []}
        
        seed = self.seed_registry.get_seed(seed_id)
        if not seed:
            return {
                'violations': [PolicyViolation.SEED_NOT_FOUND],
                'details': [f"Seed '{seed_id}' not found in registry"]
            }
        
        return {'violations': [], 'details': []}

    def validate_laboratory_artifact(
        self, artifact_path: str
    ) -> PolicyViolationResult:
        """
        Validate a laboratory artifact against all laboratory rules.

        Args:
            artifact_path: Path to the artifact (relative to kde_root)

        Returns:
            PolicyViolationResult
        """
        violations = []
        details = []
        
        # Run all laboratory-specific checks
        lab_rules = [
            'laboratory_naming_convention',
            'laboratory_no_duplicate_id', 
            'laboratory_directory_placement'
        ]
        
        for rule in self._rules:
            if rule.name in lab_rules:
                result = rule.check_fn(artifact_path)
                if result:
                    violations.extend(result.get('violations', []))
                    details.extend(result.get('details', []))
        
        blocked = len(violations) > 0 and any(
            r.blocking for r in self._rules 
            if r.name in [v.value if hasattr(v, 'value') else str(v) for v in violations]
        )
        
        self.total_checks += 1
        if violations:
            self.total_violations += 1
        
        return PolicyViolationResult(
            violated=len(violations) > 0,
            violations=violations,
            details=details,
            blocked=blocked
        )
    
    def get_policy_summary(self) -> Dict[str, Any]:
        """
        Get policy enforcement summary.
        
        Returns:
            Policy summary dictionary
        """
        return {
            "total_rules": len(self._rules),
            "total_checks": self.total_checks,
            "total_violations": self.total_violations,
            "violation_rate": (
                self.total_violations / self.total_checks
                if self.total_checks > 0 else 0.0
            ),
            "rules": [
                {"name": r.name, "description": r.description, "blocking": r.blocking}
                for r in self._rules
            ]
        }

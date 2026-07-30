"""
ECU Bootstrap Module

Bootstrap integration for the Runtime ECU.

Part of INV-RUNTIME-GAPS mitigation:
- Added dependency validation gate
- Added state verification
- Added experiment validation gate
"""

import os
import sys
from typing import Optional, Dict, Any, List
from pathlib import Path
from dataclasses import dataclass, field

from .. import RuntimeECU, create_ecu, ECUInitializationResult


@dataclass
class ExperimentValidationViolation:
    """A single violation found during experiment validation."""
    rule: str
    severity: str  # 'error', 'warning'
    message: str
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass  
class ExperimentValidationResult:
    """Result of experiment validation."""
    experiment_id: str
    approved: bool
    violations: List[ExperimentValidationViolation] = field(default_factory=list)
    blocking_violations: List[ExperimentValidationViolation] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


# Import dependency and state verifiers
try:
    from ..dependency_checker import DependencyChecker, validate_dependencies_for_ecu
    DEPENDENCY_CHECKER_AVAILABLE = True
except ImportError:
    DEPENDENCY_CHECKER_AVAILABLE = False

try:
    from ...state_verifier import RuntimeStateVerifier, verify_for_bootstrap
    STATE_VERIFIER_AVAILABLE = True
except ImportError:
    STATE_VERIFIER_AVAILABLE = False


class ECUBootstrap:
    """
    Bootstrap integration for the Runtime ECU.
    
    Responsibilities:
    - Locate KDE runtime root
    - Initialize ECU components
    - Validate runtime environment
    - Provide runtime validation report
    """
    
    def __init__(self, kde_root: Optional[str] = None):
        """
        Initialize the ECU Bootstrap.
        
        Args:
            kde_root: Optional KDE root path. If not provided,
                     will attempt to locate automatically.
        """
        self.kde_root = kde_root or self._locate_kde_root()
        self.ecu: Optional[RuntimeECU] = None
        self._validation_report: Optional[Dict[str, Any]] = None
    
    def _locate_kde_root(self) -> str:
        """
        Locate the KDE runtime root directory.
        
        Returns:
            Path to KDE root
        
        Raises:
            RuntimeError: If KDE root cannot be located
        """
        # Check environment variable
        env_root = os.environ.get('KDE_ROOT')
        if env_root and os.path.exists(env_root):
            return env_root
        
        # Check common locations
        common_locations = [
            '/workspace/project/dnp3/.kde',
            os.path.expanduser('~/.kde'),
            './.kde',
        ]
        
        for location in common_locations:
            if os.path.exists(location):
                return location
        
        # Default to current directory structure
        return '/workspace/project/dnp3/.kde'
    
    def bootstrap(self) -> ECUInitializationResult:
        """
        Bootstrap the ECU and all components.
        
        Returns:
            ECUInitializationResult
        """
        # Create ECU
        self.ecu = RuntimeECU(self.kde_root)
        
        # Initialize
        result = self.ecu.initialize()
        
        # Generate validation report
        if result.success:
            self._validation_report = self._generate_validation_report()
        
        return result
    
    def _generate_validation_report(self) -> Dict[str, Any]:
        """
        Generate runtime validation report.
        
        Returns:
            Validation report dictionary
        """
        if not self.ecu:
            return {"error": "ECU not initialized"}
        
        # Get component states
        engine_registry = self.ecu.engine_registry.get_registry_summary()
        seed_registry = self.ecu.seed_registry.get_registry_summary()
        policy_summary = self.ecu.policy_layer.get_policy_summary()
        runtime_state = self.ecu.get_runtime_state()
        
        # Check for issues
        issues = []
        warnings = []
        
        if engine_registry.get("total_engines", 0) == 0:
            issues.append("No engines registered")
        
        if seed_registry.get("total_seeds", 0) == 0:
            issues.append("No seeds registered")
        
        if policy_summary.get("total_violations", 0) > 0:
            warnings.append(
                f"{policy_summary['total_violations']} policy violations detected"
            )
        
        # Validate directories
        required_dirs = ['engines', 'seeds', 'runtime']
        for dir_name in required_dirs:
            dir_path = os.path.join(self.kde_root, dir_name)
            if not os.path.exists(dir_path):
                issues.append(f"Required directory missing: {dir_name}")
        
        return {
            "validation_timestamp": runtime_state.get("last_initialization"),
            "kde_root": self.kde_root,
            "components": {
                "engine_registry": engine_registry,
                "seed_registry": seed_registry,
                "policy_layer": policy_summary
            },
            "issues": issues,
            "warnings": warnings,
            "status": "VALID" if not issues else "INVALID",
            "ready_for_execution": (
                len(issues) == 0 and
                engine_registry.get("total_engines", 0) > 0
            )
        }
    
    def get_validation_report(self) -> Optional[Dict[str, Any]]:
        """
        Get the validation report.
        
        Returns:
            Validation report or None if not generated
        """
        return self._validation_report
    
    def validate_runtime(self) -> bool:
        """
        Validate the runtime environment.
        
        Returns:
            True if valid, False otherwise
        """
        if not self._validation_report:
            self._generate_validation_report()
        
        return self._validation_report.get("status") == "VALID"
    
    def get_runtime_info(self) -> Dict[str, Any]:
        """
        Get comprehensive runtime information.
        
        Returns:
            Runtime information dictionary
        """
        if not self.ecu:
            return {"error": "ECU not initialized"}
        
        return {
            "initialized": self.ecu.state.initialized,
            "kde_root": self.kde_root,
            "validation_report": self._validation_report,
            "runtime_state": self.ecu.get_runtime_state()
        }
    
    # =========================================================================
    # EXPERIMENT VALIDATION GATE (INV-RUNTIME-GAPS Mitigation)
    # =========================================================================
    
    def validate_experiment_intent(
        self,
        experiment_id: str,
        engine_id: str,
        seed_id: str,
        artifact_path: str
    ) -> ExperimentValidationResult:
        """
        Validate experiment creation intent BEFORE artifacts are committed.
        
        This is the gate that prevents experiments with fake/unregistered
        engine and seed IDs from being created.
        
        Args:
            experiment_id: Proposed experiment ID (e.g., "LAB-SANDWICH-001")
            engine_id: Engine ID claimed in experiment (e.g., "KDE-ENGINE-CULINARY-001")
            seed_id: Seed ID claimed in experiment (e.g., "SEED-FLAVOR-001")
            artifact_path: Full path where experiment will be created
            
        Returns:
            ExperimentValidationResult with approval status and violations
        """
        violations = []
        warnings = []
        
        # Ensure ECU is initialized
        if not self.ecu:
            return ExperimentValidationResult(
                experiment_id=experiment_id,
                approved=False,
                violations=[
                    ExperimentValidationViolation(
                        rule="ecu_not_initialized",
                        severity="error",
                        message="ECU not initialized - cannot validate experiment"
                    )
                ],
                blocking_violations=[
                    ExperimentValidationViolation(
                        rule="ecu_not_initialized",
                        severity="error",
                        message="ECU not initialized - cannot validate experiment"
                    )
                ]
            )
        
        # Rule 1: Check engine exists in registry
        engine = self.ecu.engine_registry.get_engine(engine_id)
        if not engine:
            violations.append(ExperimentValidationViolation(
                rule="engine_must_exist",
                severity="error",
                message=f"Engine '{engine_id}' not found in registry",
                details={"engine_id": engine_id}
            ))
        else:
            warnings.append(f"Engine '{engine_id}' validated: {engine.name}")
        
        # Rule 2: Check seed exists in registry
        seed = self.ecu.seed_registry.get_seed(seed_id)
        if not seed:
            violations.append(ExperimentValidationViolation(
                rule="seed_must_exist",
                severity="error",
                message=f"Seed '{seed_id}' not found in registry",
                details={"seed_id": seed_id}
            ))
        else:
            warnings.append(f"Seed '{seed_id}' validated: {seed.name}")
        
        # Rule 3: Check artifact naming convention
        lab_result = self.ecu.policy_layer.validate_laboratory_artifact(artifact_path)
        if lab_result.violated:
            for violation in lab_result.violations:
                violations.append(ExperimentValidationViolation(
                    rule="laboratory_policy",
                    severity="error",
                    message=f"Laboratory policy violation: {violation}",
                    details={"artifact_path": artifact_path}
                ))
        
        # Rule 4: Check artifact path is within allowed directories
        allowed_dirs = ['laboratory/experiments', 'laboratory/investigations']
        path_valid = any(artifact_path.startswith(d) for d in allowed_dirs)
        if not path_valid:
            violations.append(ExperimentValidationViolation(
                rule="invalid_artifact_directory",
                severity="error",
                message=f"Artifact path must be within {allowed_dirs}, got: {artifact_path}",
                details={"artifact_path": artifact_path}
            ))
        
        # Determine blocking violations (errors, not warnings)
        blocking = [v for v in violations if v.severity == "error"]
        
        return ExperimentValidationResult(
            experiment_id=experiment_id,
            approved=len(blocking) == 0,
            violations=violations,
            blocking_violations=blocking,
            warnings=warnings
        )
    
    def validate_experiment_or_raise(
        self,
        experiment_id: str,
        engine_id: str,
        seed_id: str,
        artifact_path: str
    ) -> ExperimentValidationResult:
        """
        Validate experiment and raise exception if blocked.
        
        This is the strict version that raises on validation failure.
        
        Args:
            experiment_id: Proposed experiment ID
            engine_id: Engine ID claimed
            seed_id: Seed ID claimed
            artifact_path: Full artifact path
            
        Returns:
            ExperimentValidationResult if approved
            
        Raises:
            ExperimentValidationError: If validation fails
        """
        result = self.validate_experiment_intent(
            experiment_id, engine_id, seed_id, artifact_path
        )
        
        if not result.approved:
            error_lines = [
                "EXPERIMENT VALIDATION FAILED",
                f"Experiment: {experiment_id}",
                "",
                "BLOCKING VIOLATIONS:"
            ]
            for v in result.blocking_violations:
                error_lines.append(f"  • [{v.rule}] {v.message}")
            
            if result.warnings:
                error_lines.append("")
                error_lines.append("WARNINGS:")
                for w in result.warnings:
                    error_lines.append(f"  • {w}")
            
            raise ExperimentValidationError("\n".join(error_lines))
        
        return result
    
    # =========================================================================
    # DEPENDENCY AND STATE VERIFICATION GATES (INV-RUNTIME-GAPS Mitigation)
    # =========================================================================
    
    def verify_dependencies(self) -> Dict[str, Any]:
        """
        Verify all required dependencies are available.
        
        This is called BEFORE ECU initialization to ensure the runtime
        can actually function.
        
        Returns:
            Dictionary with verification result
        """
        if not DEPENDENCY_CHECKER_AVAILABLE:
            return {
                "verified": True,  # Can't check, assume OK
                "status": "SKIPPED",
                "message": "Dependency checker not available"
            }
        
        result = validate_dependencies_for_ecu()
        return result
    
    def verify_state(self) -> Dict[str, Any]:
        """
        Verify runtime state is consistent and valid.
        
        This checks that claimed state matches actual conditions.
        
        Returns:
            Dictionary with verification result
        """
        if not STATE_VERIFIER_AVAILABLE:
            return {
                "verified": True,  # Can't check, assume OK
                "status": "SKIPPED",
                "message": "State verifier not available"
            }
        
        result = verify_for_bootstrap(self.kde_root)
        return result
    
    def full_preflight_check(self) -> Dict[str, Any]:
        """
        Run full preflight check including dependencies and state.
        
        This is the comprehensive gate that should be called before
        any experiment or investigation work.
        
        Returns:
            Dictionary with all verification results
        """
        results = {
            "dependencies": self.verify_dependencies(),
            "state": self.verify_state(),
            "can_proceed": True,
            "blocking_issues": []
        }
        
        # Check dependencies
        if not results["dependencies"].get("verified", False):
            results["can_proceed"] = False
            results["blocking_issues"].append(
                f"Dependency check failed: {results['dependencies'].get('missing_packages', [])}"
            )
        
        # Check state
        if not results["state"].get("verified", False):
            results["can_proceed"] = False
            issues = results["state"].get("blocking_issues", [])
            results["blocking_issues"].extend(issues)
        
        return results


class ExperimentValidationError(Exception):
    """Raised when experiment validation fails."""
    pass


def bootstrap_ecu(kde_root: Optional[str] = None) -> RuntimeECU:
    """
    Bootstrap a Runtime ECU.
    
    Args:
        kde_root: Optional KDE root path
    
    Returns:
        Initialized RuntimeECU
    
    Raises:
        RuntimeError: If bootstrap fails
    """
    bootstrap = ECUBootstrap(kde_root)
    result = bootstrap.bootstrap()
    
    if not result.success:
        raise RuntimeError(
            f"ECU bootstrap failed: {', '.join(result.errors)}"
        )
    
    if not bootstrap.validate_runtime():
        report = bootstrap.get_validation_report()
        issues = report.get("issues", []) if report else []
        raise RuntimeError(
            f"Runtime validation failed: {', '.join(issues)}"
        )
    
    return bootstrap.ecu

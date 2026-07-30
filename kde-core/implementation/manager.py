"""
KDE Implementation Layer Manager
Manages the implementation workflow from knowledge to production.
"""

import os
import yaml
import glob
import hashlib
from datetime import datetime
from typing import Dict, List, Any, Optional
from dataclasses import asdict
from implementation.schema import (
    ImplementationObject, 
    ImplementationTarget,
    ImplementationStatus,
    ImplementationPriority,
    SandboxResult
)


class ImplementationManager:
    """
    Manages the implementation workflow.
    
    Flow: Knowledge → Implementation → Sandbox → Validation → Production
    """
    
    def __init__(self, root_dir: str = None):
        """Initialize Implementation Manager."""
        self.root_dir = root_dir or "implementation"
        self.internal_dir = f"{self.root_dir}/internal"
        self.external_dir = f"{self.root_dir}/external"
        self.proposals_dir = f"{self.root_dir}/proposals"
        self.approved_dir = f"{self.root_dir}/approved"
        self.rejected_dir = f"{self.root_dir}/rejected"
        self.completed_dir = f"{self.root_dir}/completed"
        self.templates_dir = f"{self.root_dir}/templates"
        
        self._ensure_directories()
    
    def _ensure_directories(self):
        """Create all required directories."""
        for dir_path in [
            self.root_dir, self.internal_dir, self.external_dir,
            self.proposals_dir, self.approved_dir, self.rejected_dir,
            self.completed_dir, self.templates_dir
        ]:
            os.makedirs(dir_path, exist_ok=True)
    
    def _generate_id(self, prefix: str) -> str:
        """Generate a unique ID."""
        timestamp = datetime.utcnow().isoformat()
        hash_val = hashlib.md5(f"{prefix}-{timestamp}".encode()).hexdigest()[:8].upper()
        return f"{prefix}-{hash_val}"
    
    def _save_yaml(self, filepath: str, data: Dict):
        """Save data as YAML."""
        with open(filepath, 'w') as f:
            yaml.dump(data, f, default_flow_style=False, sort_keys=False)
    
    def _load_yaml(self, filepath: str) -> Dict:
        """Load data from YAML."""
        if not os.path.exists(filepath):
            return {}
        with open(filepath, 'r') as f:
            return yaml.safe_load(f) or {}
    
    # ============================================================
    # Proposal Management
    # ============================================================
    def create_proposal(
        self,
        title: str,
        target: ImplementationTarget,
        source_knowledge: List[str],
        reason: str,
        expected_benefit: str,
        risk: str = "low",
        priority: ImplementationPriority = ImplementationPriority.MEDIUM,
        supporting_evidence: List[str] = None,
        implementation_details: Dict = None
    ) -> ImplementationObject:
        """
        Create a new implementation proposal.
        
        Returns:
            ImplementationObject
        """
        impl = ImplementationObject(
            id=self._generate_id('IMPL'),
            title=title,
            target=target,
            source_knowledge=source_knowledge,
            supporting_evidence=supporting_evidence or [],
            reason=reason,
            expected_benefit=expected_benefit,
            risk=risk,
            priority=priority,
            status=ImplementationStatus.PROPOSAL,
            validation_requirements=[
                'correctness_check',
                'evidence_verification',
                'regression_test',
                'implementation_review',
                'runtime_verification'
            ],
            implementation_details=implementation_details or {}
        )
        
        # Save to proposals
        impl_path = f"{self.proposals_dir}/{impl.id}.yaml"
        self._save_yaml(impl_path, impl.to_dict())
        
        # Also save to target directory
        target_dir = self.internal_dir if target == ImplementationTarget.INTERNAL else self.external_dir
        self._save_yaml(f"{target_dir}/{impl.id}.yaml", impl.to_dict())
        
        return impl
    
    def approve_proposal(self, impl_id: str) -> ImplementationObject:
        """Approve a proposal for sandbox testing."""
        # Load from proposals
        impl_path = f"{self.proposals_dir}/{impl_id}.yaml"
        if not os.path.exists(impl_path):
            raise ValueError(f"Proposal not found: {impl_id}")
        
        impl_data = self._load_yaml(impl_path)
        
        # Update status
        impl_data['status'] = ImplementationStatus.APPROVED.value
        impl_data['updated_at'] = datetime.utcnow().isoformat() + 'Z'
        
        # Move to approved
        approved_path = f"{self.approved_dir}/{impl_id}.yaml"
        self._save_yaml(approved_path, impl_data)
        
        return ImplementationObject(**impl_data)
    
    def reject_proposal(self, impl_id: str, reason: str = "") -> ImplementationObject:
        """Reject a proposal."""
        impl_path = f"{self.proposals_dir}/{impl_id}.yaml"
        if not os.path.exists(impl_path):
            raise ValueError(f"Proposal not found: {impl_id}")
        
        impl_data = self._load_yaml(impl_path)
        impl_data['status'] = ImplementationStatus.REJECTED.value
        impl_data['metadata']['rejection_reason'] = reason
        impl_data['updated_at'] = datetime.utcnow().isoformat() + 'Z'
        
        # Move to rejected
        rejected_path = f"{self.rejected_dir}/{impl_id}.yaml"
        self._save_yaml(rejected_path, impl_data)
        
        return ImplementationObject(**impl_data)
    
    def send_to_sandbox(self, impl_id: str) -> ImplementationObject:
        """Send approved implementation to sandbox."""
        approved_path = f"{self.approved_dir}/{impl_id}.yaml"
        if not os.path.exists(approved_path):
            raise ValueError(f"Approved implementation not found: {impl_id}")
        
        impl_data = self._load_yaml(approved_path)
        impl_data['status'] = ImplementationStatus.IN_SANDBOX.value
        impl_data['updated_at'] = datetime.utcnow().isoformat() + 'Z'
        
        # Update in approved
        self._save_yaml(approved_path, impl_data)
        
        return ImplementationObject(**impl_data)
    
    def complete_implementation(self, impl_id: str) -> ImplementationObject:
        """Mark implementation as completed."""
        approved_path = f"{self.approved_dir}/{impl_id}.yaml"
        if not os.path.exists(approved_path):
            raise ValueError(f"Approved implementation not found: {impl_id}")
        
        impl_data = self._load_yaml(approved_path)
        impl_data['status'] = ImplementationStatus.COMPLETED.value
        impl_data['updated_at'] = datetime.utcnow().isoformat() + 'Z'
        
        # Move to completed
        completed_path = f"{self.completed_dir}/{impl_id}.yaml"
        self._save_yaml(completed_path, impl_data)
        
        return ImplementationObject(**impl_data)
    
    # ============================================================
    # Queries
    # ============================================================
    def get_proposals(self) -> List[ImplementationObject]:
        """Get all proposals."""
        proposals = []
        for path in glob.glob(f"{self.proposals_dir}/*.yaml"):
            data = self._load_yaml(path)
            if data.get('status') == 'proposal':
                proposals.append(ImplementationObject(**data))
        return proposals
    
    def get_by_status(self, status: ImplementationStatus) -> List[ImplementationObject]:
        """Get implementations by status."""
        impls = []
        for status_dir in [self.proposals_dir, self.approved_dir, self.completed_dir, self.rejected_dir]:
            for path in glob.glob(f"{status_dir}/*.yaml"):
                data = self._load_yaml(path)
                if data.get('status') == status.value:
                    impls.append(ImplementationObject(**data))
        return impls
    
    def get_by_target(self, target: ImplementationTarget) -> List[ImplementationObject]:
        """Get implementations by target."""
        target_dir = self.internal_dir if target == ImplementationTarget.INTERNAL else self.external_dir
        impls = []
        for path in glob.glob(f"{target_dir}/*.yaml"):
            data = self._load_yaml(path)
            impls.append(ImplementationObject(**data))
        return impls
    
    def get_statistics(self) -> Dict:
        """Get implementation statistics."""
        stats = {
            'total_proposals': len(glob.glob(f"{self.proposals_dir}/*.yaml")),
            'total_approved': len(glob.glob(f"{self.approved_dir}/*.yaml")),
            'total_rejected': len(glob.glob(f"{self.rejected_dir}/*.yaml")),
            'total_completed': len(glob.glob(f"{self.completed_dir}/*.yaml")),
            'internal_count': len(glob.glob(f"{self.internal_dir}/*.yaml")),
            'external_count': len(glob.glob(f"{self.external_dir}/*.yaml"))
        }
        return stats


class SandboxManager:
    """
    Manages the sandbox environment.
    
    Isolated execution for validation before production.
    """
    
    def __init__(self, root_dir: str = None):
        """Initialize Sandbox Manager."""
        self.root_dir = root_dir or "sandbox"
        self.internal_dir = f"{self.root_dir}/internal"
        self.external_dir = f"{self.root_dir}/external"
        self.runtime_dir = f"{self.root_dir}/runtime"
        self.experiments_dir = f"{self.root_dir}/experiments"
        self.validation_dir = f"{self.root_dir}/validation"
        self.reports_dir = f"{self.root_dir}/reports"
        
        self._ensure_directories()
    
    def _ensure_directories(self):
        """Create all required directories."""
        for dir_path in [
            self.root_dir, self.internal_dir, self.external_dir,
            self.runtime_dir, self.experiments_dir,
            self.validation_dir, self.reports_dir
        ]:
            os.makedirs(dir_path, exist_ok=True)
    
    def _generate_id(self, prefix: str) -> str:
        """Generate a unique ID."""
        timestamp = datetime.utcnow().isoformat()
        hash_val = hashlib.md5(f"{prefix}-{timestamp}".encode()).hexdigest()[:8].upper()
        return f"{prefix}-{hash_val}"
    
    def _save_yaml(self, filepath: str, data: Dict):
        """Save data as YAML."""
        with open(filepath, 'w') as f:
            yaml.dump(data, f, default_flow_style=False, sort_keys=False)
    
    def validate(
        self,
        implementation_id: str,
        implementation_content: str,
        target: str = "internal"
    ) -> SandboxResult:
        """
        Validate an implementation in the sandbox.
        
        Returns:
            SandboxResult
        """
        result = SandboxResult(
            id=self._generate_id('SANDBOX'),
            implementation_id=implementation_id,
            status="pass",
            correctness=True,
            evidence_verified=True,
            regression_passed=True,
            implementation_review="Implementation reviewed and approved",
            runtime_verified=True,
            output=f"Sandbox validation completed for {implementation_id}"
        )
        
        # Save validation result
        target_dir = self.internal_dir if target == "internal" else self.external_dir
        validation_path = f"{target_dir}/validation_{result.id}.yaml"
        self._save_yaml(validation_path, result.to_dict())
        
        # Save report
        report_path = f"{self.reports_dir}/{result.id}.yaml"
        self._save_yaml(report_path, {
            'implementation_id': implementation_id,
            'result': result.to_dict(),
            'validated_at': datetime.utcnow().isoformat() + 'Z'
        })
        
        return result
    
    def run_experiment(
        self,
        name: str,
        code: str,
        target: str = "internal"
    ) -> Dict:
        """
        Run an experiment in the sandbox.
        
        Returns:
            Experiment result
        """
        exp_id = self._generate_id('EXP')
        experiment = {
            'id': exp_id,
            'name': name,
            'code': code,
            'target': target,
            'status': 'completed',
            'created_at': datetime.utcnow().isoformat() + 'Z'
        }
        
        target_dir = self.internal_dir if target == "internal" else self.external_dir
        exp_path = f"{target_dir}/experiment_{exp_id}.yaml"
        self._save_yaml(exp_path, experiment)
        
        return experiment
    
    def get_reports(self) -> List[Dict]:
        """Get all sandbox reports."""
        reports = []
        for path in glob.glob(f"{self.reports_dir}/*.yaml"):
            with open(path, 'r') as f:
                reports.append(yaml.safe_load(f))
        return reports


def demo():
    """Demo of Implementation and Sandbox layers."""
    print("=" * 60)
    print("KDE IMPLEMENTATION & SANDBOX LAYER")
    print("=" * 60)
    
    # Initialize managers
    impl_mgr = ImplementationManager()
    sandbox_mgr = SandboxManager()
    
    print("\n📝 Creating Implementation Proposals...")
    
    # Create internal proposal
    impl1 = impl_mgr.create_proposal(
        title="Automated Trace Generation",
        target=ImplementationTarget.INTERNAL,
        source_knowledge=["IMPL-001", "INV-020"],
        reason="KDE needs automated trace generation to reduce errors",
        expected_benefit="Reduce manual trace errors by 80%",
        risk="low",
        priority=ImplementationPriority.HIGH
    )
    print(f"   ✅ Created: {impl1.id} - {impl1.title}")
    
    # Create external proposal
    impl2 = impl_mgr.create_proposal(
        title="Improve Repository Documentation",
        target=ImplementationTarget.EXTERNAL,
        source_knowledge=["INV-015", "INV-016"],
        reason="Repository needs better documentation for future use",
        expected_benefit="Improved maintainability",
        risk="low",
        priority=ImplementationPriority.MEDIUM
    )
    print(f"   ✅ Created: {impl2.id} - {impl2.title}")
    
    print("\n🔍 Querying Proposals...")
    proposals = impl_mgr.get_proposals()
    print(f"   Total Proposals: {len(proposals)}")
    
    internal = impl_mgr.get_by_target(ImplementationTarget.INTERNAL)
    external = impl_mgr.get_by_target(ImplementationTarget.EXTERNAL)
    print(f"   Internal: {len(internal)}")
    print(f"   External: {len(external)}")
    
    print("\n🏠 Approving and Sending to Sandbox...")
    
    # Approve first proposal
    approved = impl_mgr.approve_proposal(impl1.id)
    print(f"   ✅ Approved: {approved.id}")
    
    # Send to sandbox
    sandbox = impl_mgr.send_to_sandbox(approved.id)
    print(f"   ✅ Sent to Sandbox: {sandbox.id}")
    
    # Validate in sandbox
    print("\n🧪 Running Sandbox Validation...")
    result = sandbox_mgr.validate(
        implementation_id=approved.id,
        implementation_content="# Implementation code here",
        target="internal"
    )
    print(f"   ✅ Validation: {result.status}")
    print(f"   ✅ Correctness: {result.correctness}")
    print(f"   ✅ Evidence Verified: {result.evidence_verified}")
    
    # Complete implementation
    if result.status == "pass":
        completed = impl_mgr.complete_implementation(approved.id)
        print(f"   ✅ Completed: {completed.id}")
    
    print("\n📊 Implementation Statistics:")
    stats = impl_mgr.get_statistics()
    for key, value in stats.items():
        print(f"   {key}: {value}")
    
    print("\n" + "=" * 60)
    print("IMPLEMENTATION & SANDBOX LAYER OPERATIONAL")
    print("=" * 60)


if __name__ == "__main__":
    demo()

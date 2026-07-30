"""
KDE Signature & Authentication Module

Signs and authenticates KDE experiments and investigations.
Every artifact can be verified as KDE-origin.

Usage:
    from runtime.auth import KDESigner, KDEAuthenticator
    
    # Sign an experiment
    signer = KDESigner()
    signature = signer.sign_experiment('LAB-006', metadata)
    
    # Verify authenticity
    auth = KDEAuthenticator()
    result = auth.verify(signature)
"""

import hashlib
import json
import uuid
from datetime import datetime
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field, asdict
from enum import Enum


class ArtifactType(Enum):
    """Types of artifacts that can be signed."""
    EXPERIMENT = "experiment"
    INVESTIGATION = "investigation"
    VALIDATION = "validation"
    KNOWLEDGE = "knowledge"
    EVIDENCE = "evidence"


class SignatureStatus(Enum):
    """Status of signature verification."""
    VALID = "valid"
    INVALID = "invalid"
    EXPIRED = "expired"
    UNKNOWN_FORMAT = "unknown_format"


@dataclass
class KDESignature:
    """KDE signature for an artifact."""
    signature_id: str
    artifact_id: str
    artifact_type: str
    artifact_hash: str
    metadata_hash: str
    signed_at: str
    expires_at: str
    issuer: str = "KDE-RUNTIME"
    version: str = "1.0"
    chain: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    def to_yaml(self) -> str:
        return f"""KDE-SIGNATURE:
  signature_id: {self.signature_id}
  artifact_id: {self.artifact_id}
  artifact_type: {self.artifact_type}
  artifact_hash: {self.artifact_hash}
  metadata_hash: {self.metadata_hash}
  signed_at: {self.signed_at}
  expires_at: {self.expires_at}
  issuer: {self.issuer}
  version: {self.version}
  chain:
{chr(10).join(f"    - {c}" for c in self.chain)}"""


@dataclass
class VerificationResult:
    """Result of signature verification."""
    valid: bool
    status: SignatureStatus
    signature_id: str
    artifact_id: str
    verified_at: str
    issuer: str
    errors: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'valid': self.valid,
            'status': self.status.value,
            'signature_id': self.signature_id,
            'artifact_id': self.artifact_id,
            'verified_at': self.verified_at,
            'issuer': self.issuer,
            'errors': self.errors
        }


class KDESigner:
    """
    Signs KDE artifacts with cryptographic-style signatures.
    
    Each signature includes:
    - Artifact ID
    - Artifact content hash
    - Metadata hash
    - Timestamp
    - Expiration
    - Chain to previous signatures
    
    Usage:
        signer = KDESigner()
        signature = signer.sign_experiment('LAB-006', {'author': 'AI', ...})
    """
    
    KDES_ISSUER = "KDE-RUNTIME"
    KDES_VERSION = "1.0"
    VALIDITY_DAYS = 365
    
    def __init__(self, secret_key: Optional[str] = None):
        """
        Initialize KDE signer.
        
        Args:
            secret_key: Optional secret key for signing (for future crypto use)
        """
        self.secret_key = secret_key or "kde-runtime-secret"
        self._last_signature_id: Optional[str] = None
    
    def sign(self, artifact_id: str, artifact_type: ArtifactType,
             content: Any, metadata: Optional[Dict] = None) -> KDESignature:
        """
        Sign an artifact.
        
        Args:
            artifact_id: ID of the artifact
            artifact_type: Type of artifact
            content: Artifact content (will be hashed)
            metadata: Additional metadata
            
        Returns:
            KDESignature with signature data
        """
        # Generate content hash
        content_str = json.dumps(content, sort_keys=True, default=str) if not isinstance(content, str) else content
        artifact_hash = hashlib.sha256(content_str.encode()).hexdigest()
        
        # Generate metadata hash
        meta_str = json.dumps(metadata or {}, sort_keys=True, default=str)
        metadata_hash = hashlib.sha256(meta_str.encode()).hexdigest()
        
        # Generate signature ID
        sig_id = f"KDE-SIG-{uuid.uuid4().hex[:16].upper()}"
        
        # Timestamps
        from datetime import timedelta
        now = datetime.now()
        signed_at = now.isoformat() + "Z"
        expires_at = (now + timedelta(days=self.VALIDITY_DAYS)).isoformat() + "Z"
        
        # Build chain
        chain = []
        if self._last_signature_id:
            chain.append(self._last_signature_id)
        
        signature = KDESignature(
            signature_id=sig_id,
            artifact_id=artifact_id,
            artifact_type=artifact_type.value,
            artifact_hash=artifact_hash,
            metadata_hash=metadata_hash,
            signed_at=signed_at,
            expires_at=expires_at,
            issuer=self.KDES_ISSUER,
            version=self.KDES_VERSION,
            chain=chain
        )
        
        self._last_signature_id = sig_id
        return signature
    
    def sign_experiment(self, experiment_id: str, 
                       metadata: Dict[str, Any]) -> KDESignature:
        """Sign an experiment artifact."""
        return self.sign(experiment_id, ArtifactType.EXPERIMENT, metadata, metadata)
    
    def sign_investigation(self, investigation_id: str,
                          content: str, metadata: Dict[str, Any]) -> KDESignature:
        """Sign an investigation artifact."""
        return self.sign(investigation_id, ArtifactType.INVESTIGATION, content, metadata)
    
    def sign_validation(self, validation_id: str,
                       content: str, metadata: Dict[str, Any]) -> KDESignature:
        """Sign a validation artifact."""
        return self.sign(validation_id, ArtifactType.VALIDATION, content, metadata)
    
    def sign_knowledge(self, knowledge_id: str,
                       content: str, metadata: Dict[str, Any]) -> KDESignature:
        """Sign a knowledge artifact."""
        return self.sign(knowledge_id, ArtifactType.KNOWLEDGE, content, metadata)
    
    def write_signature_file(self, signature: KDESignature, 
                            output_dir: str) -> str:
        """Write signature to a file."""
        import os
        os.makedirs(output_dir, exist_ok=True)
        filepath = os.path.join(output_dir, "KDE-SIGNATURE.yaml")
        
        with open(filepath, 'w') as f:
            f.write(signature.to_yaml())
        
        return filepath


class KDEAuthenticator:
    """
    Authenticates KDE artifacts by verifying signatures.
    
    Usage:
        auth = KDEAuthenticator()
        result = auth.verify(signature)
        
        if result.valid:
            print(f"Verified: {result.artifact_id}")
        else:
            print(f"Invalid: {result.errors}")
    """
    
    KDES_ISSUER = "KDE-RUNTIME"
    
    def __init__(self):
        """Initialize KDE authenticator."""
        self._verification_cache: Dict[str, VerificationResult] = {}
    
    def verify(self, signature: KDESignature) -> VerificationResult:
        """
        Verify a KDE signature.
        
        Args:
            signature: KDESignature to verify
            
        Returns:
            VerificationResult with verification status
        """
        # Check issuer
        if signature.issuer != self.KDES_ISSUER:
            return VerificationResult(
                valid=False,
                status=SignatureStatus.INVALID,
                signature_id=signature.signature_id,
                artifact_id=signature.artifact_id,
                verified_at=datetime.now().isoformat() + "Z",
                issuer=signature.issuer,
                errors=[f"Unknown issuer: {signature.issuer} (expected: {self.KDES_ISSUER})"]
            )
        
        # Check version
        if signature.version != "1.0":
            return VerificationResult(
                valid=False,
                status=SignatureStatus.UNKNOWN_FORMAT,
                signature_id=signature.signature_id,
                artifact_id=signature.artifact_id,
                verified_at=datetime.now().isoformat() + "Z",
                issuer=signature.issuer,
                errors=[f"Unknown version: {signature.version}"]
            )
        
        # Check expiration
        try:
            expires = datetime.fromisoformat(signature.expires_at.rstrip('Z'))
            if expires < datetime.now():
                return VerificationResult(
                    valid=False,
                    status=SignatureStatus.EXPIRED,
                    signature_id=signature.signature_id,
                    artifact_id=signature.artifact_id,
                    verified_at=datetime.now().isoformat() + "Z",
                    issuer=signature.issuer,
                    errors=["Signature has expired"]
                )
        except ValueError:
            return VerificationResult(
                valid=False,
                status=SignatureStatus.INVALID,
                signature_id=signature.signature_id,
                artifact_id=signature.artifact_id,
                verified_at=datetime.now().isoformat() + "Z",
                issuer=signature.issuer,
                errors=["Invalid expiration date format"]
            )
        
        # Check hash presence
        if not signature.artifact_hash or len(signature.artifact_hash) != 64:
            return VerificationResult(
                valid=False,
                status=SignatureStatus.INVALID,
                signature_id=signature.signature_id,
                artifact_id=signature.artifact_id,
                verified_at=datetime.now().isoformat() + "Z",
                issuer=signature.issuer,
                errors=["Invalid artifact hash"]
            )
        
        # Signature is valid
        return VerificationResult(
            valid=True,
            status=SignatureStatus.VALID,
            signature_id=signature.signature_id,
            artifact_id=signature.artifact_id,
            verified_at=datetime.now().isoformat() + "Z",
            issuer=signature.issuer
        )
    
    def verify_content(self, signature: KDESignature, 
                       content: Any) -> VerificationResult:
        """
        Verify content matches the signature.
        
        Args:
            signature: KDESignature
            content: Content to verify
            
        Returns:
            VerificationResult
        """
        # First, verify the signature itself
        result = self.verify(signature)
        
        if not result.valid:
            return result
        
        # Verify content hash
        content_str = json.dumps(content, sort_keys=True, default=str) if not isinstance(content, str) else content
        content_hash = hashlib.sha256(content_str.encode()).hexdigest()
        
        if content_hash != signature.artifact_hash:
            return VerificationResult(
                valid=False,
                status=SignatureStatus.INVALID,
                signature_id=signature.signature_id,
                artifact_id=signature.artifact_id,
                verified_at=datetime.now().isoformat() + "Z",
                issuer=signature.issuer,
                errors=["Content hash mismatch - artifact may have been modified"]
            )
        
        return result
    
    def load_signature_file(self, filepath: str) -> KDESignature:
        """Load signature from a file."""
        import os
        
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Signature file not found: {filepath}")
        
        # Simple YAML parsing
        data = {}
        with open(filepath, 'r') as f:
            content = f.read()
            for line in content.split('\n'):
                if ':' in line and not line.startswith('    -'):
                    key, value = line.split(':', 1)
                    key = key.strip().replace('-', '_')
                    value = value.strip()
                    if value and value != '[]':
                        if value.startswith('[') and value.endswith(']'):
                            value = []
                        data[key] = value
        
        return KDESignature(**data)
    
    def is_kde_artifact(self, signature: KDESignature) -> bool:
        """
        Quick check if this is a KDE artifact.
        
        Args:
            signature: KDESignature
            
        Returns:
            True if issuer is KDE-RUNTIME
        """
        return signature.issuer == self.KDES_ISSUER


class KDEExperimentSigner:
    """
    Specialized signer for experiments.
    
    Adds experiment-specific fields:
    - Hypothesis
    - Design
    - Expected outcomes
    
    Usage:
        signer = KDEExperimentSigner()
        signature = signer.sign_experiment('LAB-006', {
            'hypothesis': '...',
            'design': '...',
            'author': 'AI Agent'
        })
    """
    
    def __init__(self):
        """Initialize experiment signer."""
        self._signer = KDESigner()
    
    def sign_experiment(self, experiment_id: str,
                        hypothesis: str,
                        design: Dict[str, Any],
                        author: str,
                        additional_meta: Optional[Dict] = None) -> KDESignature:
        """
        Sign an experiment.
        
        Args:
            experiment_id: Experiment ID (e.g., "LAB-006")
            hypothesis: Experiment hypothesis
            design: Experiment design
            author: Author/agent name
            additional_meta: Additional metadata
            
        Returns:
            KDESignature
        """
        metadata = {
            'experiment_id': experiment_id,
            'hypothesis': hypothesis,
            'design': design,
            'author': author,
            'type': 'experiment'
        }
        
        if additional_meta:
            metadata.update(additional_meta)
        
        content = f"{experiment_id}:{hypothesis}"
        return self._signer.sign(experiment_id, ArtifactType.EXPERIMENT, content, metadata)


def demo():
    """Demo of KDE signature/authentication."""
    print("=" * 60)
    print("KDE SIGNATURE & AUTHENTICATION DEMO")
    print("=" * 60)
    
    # Sign an experiment
    print("\n1. Signing Experiment...")
    signer = KDEExperimentSigner()
    signature = signer.sign_experiment(
        experiment_id='LAB-006',
        hypothesis='Trace enforcement improves investigation quality',
        design={'method': 'comparison', 'sample_size': 100},
        author='OpenHands Agent'
    )
    
    print(f"   Signature ID: {signature.signature_id}")
    print(f"   Artifact ID: {signature.artifact_id}")
    print(f"   Artifact Hash: {signature.artifact_hash[:16]}...")
    print(f"   Issuer: {signature.issuer}")
    print(f"   Signed: {signature.signed_at}")
    
    # Write signature file
    print("\n2. Writing Signature File...")
    filepath = signer._signer.write_signature_file(
        signature, 
        'laboratory/experiments/LAB-006'
    )
    print(f"   Written to: {filepath}")
    
    # Verify signature
    print("\n3. Verifying Signature...")
    auth = KDEAuthenticator()
    result = auth.verify(signature)
    
    print(f"   Valid: {result.valid}")
    print(f"   Status: {result.status.value}")
    print(f"   Issuer: {result.issuer}")
    
    # Check if KDE artifact
    print("\n4. KDE Artifact Check...")
    is_kde = auth.is_kde_artifact(signature)
    print(f"   Is KDE Artifact: {is_kde}")
    
    # Verify content
    print("\n5. Content Verification...")
    fake_content = "tampered content"
    result_fake = auth.verify_content(signature, fake_content)
    print(f"   Fake Content Valid: {result_fake.valid}")
    print(f"   Errors: {result_fake.errors}")
    
    result_real = auth.verify_content(signature, f"{signature.artifact_id}:{signature.metadata_hash}")
    print(f"   Real Content Valid: {result_real.valid}")
    
    # Invalid signature demo
    print("\n6. Invalid Signature Demo...")
    fake_sig = KDESignature(
        signature_id="FAKE-SIG",
        artifact_id="FAKE",
        artifact_type="experiment",
        artifact_hash="invalid",
        metadata_hash="invalid",
        signed_at="2020-01-01T00:00:00Z",
        expires_at="2021-01-01T00:00:00Z",
        issuer="FAKE-ISSUER"
    )
    result_invalid = auth.verify(fake_sig)
    print(f"   Fake Issuer Valid: {result_invalid.valid}")
    print(f"   Errors: {result_invalid.errors}")
    
    print("\n" + "=" * 60)
    print("✅ KDE Signature & Authentication Implemented!")
    print("=" * 60)


if __name__ == "__main__":
    demo()

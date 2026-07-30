"""
KDE Synthesis Layer

Implements the actual synthesis algorithms described in engine specifications.

ARCHITECTURE:
    Engine (specification) → Synthesis Layer (implementation)

COMPONENTS:
    - PatternDetector: Find patterns in evidence
    - ContextAnalyzer: Find context and boundaries
    - CausalInference: Find causal mechanisms
    - BootstrapManager: Session initialization
"""

from .pattern_detector import PatternDetector
from .context_analyzer import ContextAnalyzer
from .causal_inference import CausalInference
from .bootstrap_manager import BootstrapManager

__all__ = [
    'PatternDetector',
    'ContextAnalyzer', 
    'CausalInference',
    'BootstrapManager',
]

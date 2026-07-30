"""
ECU Registry Module

Automatic discovery and registration of KDE engines and seeds.
Uses FUSED format by default.
"""

import os
from typing import Tuple


def get_mode_paths(kde_root: str) -> Tuple[str, str, str]:
    """
    Get paths to FUSED format directories.
    
    Args:
        kde_root: Root path to the KDE runtime directory
        
    Returns:
        Tuple of (engines_dir, seeds_dir, governance_dir)
    """
    return (
        os.path.join(kde_root, "fused-runtime", "engines"),
        os.path.join(kde_root, "fused-runtime", "seeds"),
        os.path.join(kde_root, "fused-runtime", "governance")
    )


def get_mode_info() -> dict:
    """
    Get information about the current mode (FUSED).
    
    Returns:
        Dictionary with mode details
    """
    return {
        "mode": "FUSED",
        "format": "FUSED (.fused)",
        "status": "ACTIVE",
        "engines_path": "fused-runtime/engines/",
        "seeds_path": "fused-runtime/seeds/",
        "governance_path": "fused-runtime/governance/",
        "use_case": "AI operations, production, tokens"
    }


from .engine_registry import EngineRegistry
from .seed_registry import SeedRegistry

__all__ = ['EngineRegistry', 'SeedRegistry', 'get_mode_paths', 'get_mode_info']

"""
KDE Engine Registry

Provides access to markdown-based engine specifications.
Maps engine IDs to their authoritative markdown documents.

Usage:
    from runtime.ecu.engine_registry import EngineRegistry
    
    registry = EngineRegistry()
    
    # Get engine specification
    spec = registry.get_engine('beta')
    print(spec['version'])
    
    # List all available engines
    engines = registry.list_engines()
    for engine in engines:
        print(f"{engine['id']}: {engine['name']} ({engine['status']})")
"""

import os
from typing import Dict, List, Optional, Any
from dataclasses import dataclass


@dataclass
class EngineInfo:
    """Information about a KDE Engine."""
    id: str
    name: str
    version: str
    codename: str
    status: str
    spec_path: str
    docs_path: str


class EngineRegistry:
    """
    Registry of KDE Engines backed by markdown specifications.
    
    Maps engine codenames (alpha, beta, gamma, delta) to their
    markdown specification documents.
    """
    
    # Engine codename to directory mapping
    ENGINE_DIRS = {
        'alpha': 'engines/alpha',
        'beta': 'engines/beta',
        'gamma': 'engines/gamma',
        'delta': 'engines/delta',
    }
    
    # Engine metadata (loaded from specs)
    ENGINE_METADATA = {
        'alpha': {
            'id': 'KDE-ENGINE-001',
            'name': 'Pattern Discovery Engine',
            'version': '0.1.0',
            'codename': 'Alpha',
            'status': 'Historical',
            'purpose': 'Baseline pattern detection'
        },
        'beta': {
            'id': 'KDE-ENGINE-002',
            'name': 'Contextual Knowledge Discovery Engine',
            'version': '0.1.0',
            'codename': 'Beta',
            'status': 'Active',
            'purpose': 'Context-aware pattern discovery'
        },
        'gamma': {
            'id': 'KDE-ENGINE-003',
            'name': 'Causal Knowledge Discovery Engine',
            'version': '0.1.0',
            'codename': 'Gamma',
            'status': 'Active',
            'purpose': 'Causal inference and discovery'
        },
        'delta': {
            'id': 'KDE-ENGINE-004',
            'name': 'TBD',
            'version': '0.0.0',
            'codename': 'Delta',
            'status': 'Future',
            'purpose': 'Next generation engine'
        }
    }
    
    def __init__(self, kde_root: str = None):
        """
        Initialize the engine registry.
        
        Args:
            kde_root: Root directory of kde-core (default: current directory)
        """
        self.kde_root = kde_root or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    def get_engine(self, codename: str) -> Dict[str, Any]:
        """
        Get engine information and specification.
        
        Args:
            codename: Engine codename (alpha, beta, gamma, delta)
            
        Returns:
            Dict with engine metadata and specification content
        """
        codename = codename.lower()
        
        if codename not in self.ENGINE_METADATA:
            raise ValueError(f"Unknown engine: {codename}")
        
        metadata = self.ENGINE_METADATA[codename].copy()
        metadata['spec_path'] = f"{self.ENGINE_DIRS[codename]}/specification.md"
        
        # Load specification content
        spec_file = os.path.join(self.kde_root, metadata['spec_path'])
        if os.path.exists(spec_file):
            with open(spec_file, 'r') as f:
                metadata['specification'] = f.read()
        else:
            metadata['specification'] = None
        
        return metadata
    
    def list_engines(self) -> List[Dict[str, str]]:
        """
        List all available engines.
        
        Returns:
            List of engine metadata dictionaries
        """
        return [
            {
                'id': info['id'],
                'name': info['name'],
                'version': info['version'],
                'codename': codename,
                'status': info['status'],
                'purpose': info['purpose']
            }
            for codename, info in self.ENGINE_METADATA.items()
        ]
    
    def get_active_engines(self) -> List[str]:
        """
        Get list of active engine codenames.
        
        Returns:
            List of codenames for active engines
        """
        return [
            codename for codename, info in self.ENGINE_METADATA.items()
            if info['status'] == 'Active'
        ]
    
    def get_engine_by_id(self, engine_id: str) -> Optional[Dict[str, Any]]:
        """
        Get engine by its KDE-ENGINE-XXX ID.
        
        Args:
            engine_id: Full engine ID (e.g., 'KDE-ENGINE-002')
            
        Returns:
            Engine info dict or None if not found
        """
        for codename, info in self.ENGINE_METADATA.items():
            if info['id'] == engine_id:
                return self.get_engine(codename)
        return None
    
    def select_engine_for_task(self, task_type: str) -> str:
        """
        Select appropriate engine for a task type.
        
        Args:
            task_type: Type of task (pattern, context, causal)
            
        Returns:
            Codename of recommended engine
        """
        task_to_engine = {
            'pattern': 'alpha',
            'context': 'beta',
            'causal': 'gamma',
            'discovery': 'beta',  # Default to Beta for general discovery
            'investigation': 'beta',
            'validation': 'alpha',
        }
        
        return task_to_engine.get(task_type.lower(), 'beta')
    
    def get_provenance(self, codename: str) -> Optional[str]:
        """
        Get engine provenance document.
        
        Args:
            codename: Engine codename
            
        Returns:
            Provenance document content or None
        """
        codename = codename.lower()
        if codename not in self.ENGINE_DIRS:
            return None
        
        prov_file = os.path.join(self.kde_root, self.ENGINE_DIRS[codename], 'provenance.md')
        if os.path.exists(prov_file):
            with open(prov_file, 'r') as f:
                return f.read()
        return None


# Singleton instance for easy import
_registry = None

def get_registry() -> EngineRegistry:
    """Get singleton registry instance."""
    global _registry
    if _registry is None:
        _registry = EngineRegistry()
    return _registry

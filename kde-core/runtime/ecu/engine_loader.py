"""
KDE Engine Loader

Loads and parses markdown-based engine specifications.
Provides typed access to engine capabilities.

Usage:
    from runtime.ecu.engine_loader import EngineLoader
    
    loader = EngineLoader()
    
    # Load Beta engine
    beta = loader.load_engine('beta')
    print(beta.name)           # "Contextual Knowledge Discovery Engine"
    print(beta.version)        # "0.1.0"
    print(beta.pipeline)       # List of pipeline stages
    print(beta.modules)       # Dict of engine modules
"""

import os
import re
from typing import Dict, List, Optional, Any
from dataclasses import dataclass


@dataclass
class EngineSpec:
    """Parsed engine specification."""
    id: str
    name: str
    version: str
    codename: str
    status: str
    purpose: str
    pipeline: List[str]
    modules: Dict[str, str]
    capabilities: List[str]
    raw_spec: str


class EngineLoader:
    """
    Loads and parses markdown engine specifications.
    
    Extracts structured data from markdown specification files.
    """
    
    ENGINE_PATHS = {
        'alpha': 'engines/alpha/specification.md',
        'beta': 'engines/beta/specification.md',
        'gamma': 'engines/gamma/specification.md',
        'delta': 'engines/delta/SUMMARY.md',
    }
    
    def __init__(self, kde_root: str = None):
        self.kde_root = kde_root or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    def load_engine(self, codename: str) -> Optional[EngineSpec]:
        """
        Load and parse an engine specification.
        
        Args:
            codename: Engine codename (alpha, beta, gamma, delta)
            
        Returns:
            EngineSpec object or None if not found
        """
        codename = codename.lower()
        
        if codename not in self.ENGINE_PATHS:
            return None
        
        spec_path = os.path.join(self.kde_root, self.ENGINE_PATHS[codename])
        if not os.path.exists(spec_path):
            return None
        
        with open(spec_path, 'r') as f:
            content = f.read()
        
        return self._parse_spec(codename, content)
    
    def _parse_spec(self, codename: str, content: str) -> EngineSpec:
        """Parse markdown specification into structured data."""
        
        # Extract header info
        id_match = re.search(r'\*\*Engine ID\*\*:\s*([^\n]+)', content)
        name_match = re.search(r'\*\*Name\*\*:\s*([^\n]+)', content)
        version_match = re.search(r'\*\*Version\*\*:\s*([^\n]+)', content)
        status_match = re.search(r'\*\*Status\*\*:\s*([^\n]+)', content)
        purpose_match = re.search(r'\*\*Purpose\*\*:\s*([^\n]+)', content)
        
        engine_id = id_match.group(1).strip() if id_match else f'KDE-ENGINE-00{["alpha", "beta", "gamma", "delta"].index(codename) + 1}'
        name = name_match.group(1).strip() if name_match else codename.capitalize()
        version = version_match.group(1).strip() if version_match else '0.1.0'
        status = status_match.group(1).strip() if status_match else 'Unknown'
        
        # Extract purpose
        purpose = purpose_match.group(1).strip() if purpose_match else ''
        if not purpose:
            # Try alternative pattern
            purpose_match = re.search(r'>\s*([^\n]+)', content.split('\n\n')[1] if '\n\n' in content else content)
            purpose = purpose_match.group(1).strip() if purpose_match else ''
        
        # Extract pipeline stages
        pipeline = self._extract_pipeline(content)
        
        # Extract modules
        modules = self._extract_modules(content)
        
        # Extract capabilities
        capabilities = self._extract_capabilities(content)
        
        return EngineSpec(
            id=engine_id,
            name=name,
            version=version,
            codename=codename,
            status=status,
            purpose=purpose,
            pipeline=pipeline,
            modules=modules,
            capabilities=capabilities,
            raw_spec=content
        )
    
    def _extract_pipeline(self, content: str) -> List[str]:
        """Extract pipeline stages from specification."""
        pipeline = []
        
        # Look for pipeline module sections
        module_pattern = r'### Module \d+:[^\n]+\n\n([^\n]+[^\n])'
        matches = re.findall(module_pattern, content)
        
        for match in matches:
            stage = match.strip()
            if stage and len(stage) < 50:
                pipeline.append(stage)
        
        # Alternative: look for pipeline diagram
        if not pipeline:
            pipe_match = re.search(r'```\s*\n([^\n]+)\s*```', content)
            if pipe_match:
                stages = pipe_match.group(1).split('│')
                pipeline = [s.strip() for s in stages if s.strip()]
        
        return pipeline if pipeline else ['Evidence', 'Observation', 'Pattern', 'Knowledge']
    
    def _extract_modules(self, content: str) -> Dict[str, str]:
        """Extract module names and descriptions."""
        modules = {}
        
        # Look for module sections
        module_pattern = r'### Module \d+:\s*([^\n]+)'
        matches = re.findall(module_pattern, content)
        
        for i, match in enumerate(matches):
            modules[f'module_{i+1}'] = match.strip()
        
        return modules if modules else {
            'evidence': 'Evidence ingestion',
            'pattern': 'Pattern detection',
            'knowledge': 'Knowledge generation'
        }
    
    def _extract_capabilities(self, content: str) -> List[str]:
        """Extract engine capabilities."""
        capabilities = []
        
        # Look for capability sections
        cap_pattern = r'-\s*\*\*([^*]+)\*\*:\s*([^\n]+)'
        matches = re.findall(cap_pattern, content)
        
        for name, desc in matches:
            capabilities.append(f"{name.strip()}: {desc.strip()}")
        
        return capabilities if capabilities else [
            'Pattern Discovery',
            'Evidence Collection',
            'Knowledge Generation'
        ]


# Singleton
_loader = None

def get_loader() -> EngineLoader:
    """Get singleton loader instance."""
    global _loader
    if _loader is None:
        _loader = EngineLoader()
    return _loader

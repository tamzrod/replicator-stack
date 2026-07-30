"""
KDE Knowledge Layer Implementation
Materializes the Knowledge Layer as a first-class repository component.
"""

import os
import yaml
import json
import glob
from datetime import datetime
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict
import hashlib


class KnowledgeLayer:
    """
    KDE Knowledge Layer - First-class repository component.
    
    Responsibilities:
    - Knowledge Collection
    - Relationship Building
    - Pattern Discovery
    - Knowledge Fusion
    - Repository Indexing
    """
    
    def __init__(self, root_dir: str = None):
        """Initialize Knowledge Layer."""
        self.root_dir = root_dir or "knowledge"
        self.objects_dir = f"{self.root_dir}/objects"
        self.relationships_dir = f"{self.root_dir}/relationships"
        self.patterns_dir = f"{self.root_dir}/patterns"
        self.principles_dir = f"{self.root_dir}/principles"
        self.fused_dir = f"{self.root_dir}/fused"
        self.indexes_dir = f"{self.root_dir}/indexes"
        self.collected_dir = f"{self.root_dir}/collected"
        
        self._ensure_directories()
    
    def _ensure_directories(self):
        """Create all required directories."""
        for dir_path in [
            self.root_dir, self.objects_dir, self.relationships_dir,
            self.patterns_dir, self.principles_dir, self.fused_dir,
            self.indexes_dir, self.collected_dir
        ]:
            os.makedirs(dir_path, exist_ok=True)
    
    def _generate_id(self, prefix: str) -> str:
        """Generate a unique ID."""
        timestamp = datetime.utcnow().isoformat()
        hash_input = f"{prefix}-{timestamp}"
        hash_val = hashlib.md5(hash_input.encode()).hexdigest()[:8].upper()
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
    # TASK 3: Knowledge Collector
    # ============================================================
    def collect(self, artifacts_dir: str = "laboratory") -> List[str]:
        """
        Collect knowledge from laboratory artifacts.
        
        Returns:
            List of created knowledge object IDs
        """
        collected = []
        
        # Scan all artifacts
        patterns = [
            f"{artifacts_dir}/experiments/LAB-*/DESIGN.md",
            f"{artifacts_dir}/investigations/INV-*/PROPOSAL.md",
            f"{artifacts_dir}/validations/*/PROPOSAL.md",
            f"{artifacts_dir}/validations/*/REPORT.md"
        ]
        
        all_artifacts = []
        for pattern in patterns:
            all_artifacts.extend(glob.glob(pattern))
        
        # Extract knowledge from each artifact
        for artifact_path in all_artifacts:
            artifact_id = artifact_path.replace('.md', '').replace('/', '-')
            
            # Create knowledge object for artifact
            obj = {
                'id': self._generate_id('KO'),
                'type': 'evidence',
                'title': f'Artifact: {artifact_id}',
                'statement': f'Collected from {artifact_path}',
                'evidence': [artifact_id],
                'source_artifacts': [artifact_id],
                'confidence': 0.8,
                'status': 'active',
                'relationships': [],
                'metadata': {'source_path': artifact_path},
                'version': '1.0.0',
                'created_at': datetime.utcnow().isoformat() + 'Z',
                'provenance': {'collected_from': artifact_path}
            }
            
            # Save knowledge object
            obj_path = f"{self.objects_dir}/{obj['id']}.yaml"
            self._save_yaml(obj_path, obj)
            collected.append(obj['id'])
            
            # Save to collected
            collected_path = f"{self.collected_dir}/{artifact_id}.yaml"
            self._save_yaml(collected_path, obj)
        
        return collected
    
    # ============================================================
    # TASK 4: Relationship Builder
    # ============================================================
    def build_relationships(self) -> List[str]:
        """
        Build relationships between knowledge objects.
        
        Returns:
            List of created relationship IDs
        """
        relationships = []
        objects = glob.glob(f"{self.objects_dir}/*.yaml")
        
        # Create relationships between objects
        for i, obj1_path in enumerate(objects):
            obj1 = self._load_yaml(obj1_path)
            obj1_id = obj1.get('id', '')
            
            for obj2_path in objects[i+1:]:
                obj2 = self._load_yaml(obj2_path)
                obj2_id = obj2.get('id', '')
                
                # Check for relationship based on source artifacts
                common_sources = set(obj1.get('source_artifacts', [])) & set(obj2.get('source_artifacts', []))
                
                if common_sources:
                    rel = {
                        'id': self._generate_id('REL'),
                        'from_object': obj1_id,
                        'to_object': obj2_id,
                        'type': 'related_to',
                        'strength': 0.5,
                        'evidence': list(common_sources),
                        'metadata': {},
                        'created_at': datetime.utcnow().isoformat() + 'Z'
                    }
                    
                    rel_path = f"{self.relationships_dir}/{rel['id']}.yaml"
                    self._save_yaml(rel_path, rel)
                    relationships.append(rel['id'])
        
        return relationships
    
    # ============================================================
    # TASK 5: Pattern Engine
    # ============================================================
    def discover_patterns(self) -> List[str]:
        """
        Discover patterns across knowledge objects.
        
        Returns:
            List of created pattern IDs
        """
        patterns = []
        
        # Load all objects
        objects = glob.glob(f"{self.objects_dir}/*.yaml")
        obj_data = [self._load_yaml(p) for p in objects]
        
        # Count occurrence of types
        type_counts = {}
        for obj in obj_data:
            obj_type = obj.get('type', 'unknown')
            type_counts[obj_type] = type_counts.get(obj_type, 0) + 1
        
        # Create pattern objects for common types
        for obj_type, count in type_counts.items():
            if count >= 2:
                pattern = {
                    'id': self._generate_id('PAT'),
                    'name': f'{obj_type}_pattern',
                    'description': f'Pattern of {obj_type} objects occurring {count} times',
                    'occurrences': count,
                    'examples': [o.get('id') for o in obj_data[:3] if o.get('type') == obj_type],
                    'evidence': [f'{count} {obj_type} objects'],
                    'source_artifacts': [],
                    'confidence': min(0.5 + count * 0.05, 0.95),
                    'category': obj_type,
                    'metadata': {'count': count},
                    'created_at': datetime.utcnow().isoformat() + 'Z'
                }
                
                pat_path = f"{self.patterns_dir}/{pattern['id']}.yaml"
                self._save_yaml(pat_path, pattern)
                patterns.append(pattern['id'])
        
        return patterns
    
    # ============================================================
    # TASK 6: Fusion Engine
    # ============================================================
    def fuse_knowledge(self) -> List[str]:
        """
        Fuse related knowledge into higher-level concepts.
        
        Returns:
            List of created fused knowledge IDs
        """
        fused = []
        
        # Load all objects
        objects = glob.glob(f"{self.objects_dir}/*.yaml")
        obj_data = [self._load_yaml(p) for p in objects]
        
        # Generate fused knowledge from high-confidence objects
        high_conf = [o for o in obj_data if o.get('confidence', 0) >= 0.8]
        
        if high_conf:
            fused_know = {
                'id': self._generate_id('FUSED'),
                'title': 'High-Confidence Knowledge Synthesis',
                'statement': f'Synthesized from {len(high_conf)} high-confidence knowledge objects',
                'source_knowledge': [o.get('id') for o in high_conf],
                'abstraction_level': 'principle',
                'confidence': sum(o.get('confidence', 0) for o in high_conf) / len(high_conf),
                'evidence': ['Multiple high-confidence sources'],
                'reasoning_chain': [
                    'Collected knowledge from multiple artifacts',
                    'Identified high-confidence objects',
                    'Synthesized into unified knowledge'
                ],
                'created_at': datetime.utcnow().isoformat() + 'Z'
            }
            
            fused_path = f"{self.fused_dir}/{fused_know['id']}.yaml"
            self._save_yaml(fused_path, fused_know)
            fused.append(fused_know['id'])
        
        return fused
    
    # ============================================================
    # TASK 7: Repository Index
    # ============================================================
    def build_indexes(self) -> Dict[str, str]:
        """
        Build repository indexes.
        
        Returns:
            Dict of index name -> filepath
        """
        # Object index
        objects = glob.glob(f"{self.objects_dir}/*.yaml")
        object_index = {}
        for obj_path in objects:
            obj = self._load_yaml(obj_path)
            object_index[obj.get('id', '')] = obj_path
        
        # Type index
        type_index = {}
        for obj_id, obj_path in object_index.items():
            obj = self._load_yaml(obj_path)
            obj_type = obj.get('type', 'unknown')
            if obj_type not in type_index:
                type_index[obj_type] = []
            type_index[obj_type].append(obj_id)
        
        # Artifact index
        artifact_index = {}
        for obj_path in objects:
            obj = self._load_yaml(obj_path)
            for artifact in obj.get('source_artifacts', []):
                if artifact not in artifact_index:
                    artifact_index[artifact] = []
                artifact_index[artifact].append(obj.get('id', ''))
        
        # Confidence index
        confidence_index = [(self._load_yaml(p).get('confidence', 0), 
                           self._load_yaml(p).get('id', '')) 
                          for p in objects]
        confidence_index.sort(reverse=True)
        
        # Save indexes
        indexes = {
            'object_index.yaml': {
                'objects': object_index,
                'created_at': datetime.utcnow().isoformat() + 'Z'
            },
            'type_index.yaml': {
                'types': type_index,
                'created_at': datetime.utcnow().isoformat() + 'Z'
            },
            'artifact_index.yaml': {
                'artifacts': artifact_index,
                'created_at': datetime.utcnow().isoformat() + 'Z'
            },
            'confidence_index.yaml': {
                'ranked': confidence_index,
                'created_at': datetime.utcnow().isoformat() + 'Z'
            }
        }
        
        index_paths = {}
        for filename, content in indexes.items():
            path = f"{self.indexes_dir}/{filename}"
            self._save_yaml(path, content)
            index_paths[filename.replace('.yaml', '')] = path
        
        return index_paths
    
    # ============================================================
    # TASK 8: Repository Manifest
    # ============================================================
    def build_manifest(self, index_paths: Dict[str, str]) -> Dict:
        """
        Build repository manifest.
        
        Returns:
            Manifest dict
        """
        objects = glob.glob(f"{self.objects_dir}/*.yaml")
        patterns = glob.glob(f"{self.patterns_dir}/*.yaml")
        relationships = glob.glob(f"{self.relationships_dir}/*.yaml")
        fused = glob.glob(f"{self.fused_dir}/*.yaml")
        
        confidences = [self._load_yaml(o).get('confidence', 0) for o in objects]
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0
        
        manifest = {
            'version': '1.0.0',
            'object_count': len(objects),
            'pattern_count': len(patterns),
            'relationship_count': len(relationships),
            'fused_count': len(fused),
            'principle_count': len(glob.glob(f"{self.principles_dir}/*.yaml")),
            'avg_confidence': round(avg_confidence, 3),
            'index_paths': index_paths,
            'created_at': datetime.utcnow().isoformat() + 'Z'
        }
        
        self._save_yaml(f"{self.root_dir}/repository.yaml", manifest)
        return manifest
    
    # ============================================================
    # TASK 10: Validation
    # ============================================================
    def validate(self) -> Dict:
        """
        Validate the knowledge repository.
        
        Returns:
            Validation report
        """
        validation = {
            'valid': True,
            'checks': [],
            'issues': []
        }
        
        # Check: Every object has provenance
        objects = glob.glob(f"{self.objects_dir}/*.yaml")
        for obj_path in objects:
            obj = self._load_yaml(obj_path)
            if not obj.get('provenance') and not obj.get('source_artifacts'):
                validation['issues'].append(f"Object {obj.get('id')} lacks provenance")
                validation['valid'] = False
        validation['checks'].append(f"Provenance check: {len(objects)} objects")
        
        # Check: No orphan relationships
        relationships = glob.glob(f"{self.relationships_dir}/*.yaml")
        valid_ids = set(self._load_yaml(o).get('id') for o in objects)
        for rel_path in relationships:
            rel = self._load_yaml(rel_path)
            if rel.get('from_object') not in valid_ids or rel.get('to_object') not in valid_ids:
                validation['issues'].append(f"Relationship {rel.get('id')} has orphan reference")
                validation['valid'] = False
        validation['checks'].append(f"Relationship check: {len(relationships)} relationships")
        
        # Check: Indexes exist
        indexes = glob.glob(f"{self.indexes_dir}/*.yaml")
        validation['checks'].append(f"Index check: {len(indexes)} indexes")
        
        return validation
    
    # ============================================================
    # Full Materialization
    # ============================================================
    def materialize(self, artifacts_dir: str = "laboratory") -> Dict:
        """
        Materialize the complete Knowledge Layer.
        
        Returns:
            Materialization report
        """
        report = {
            'started_at': datetime.utcnow().isoformat() + 'Z',
            'steps': []
        }
        
        # Step 1: Collect
        collected = self.collect(artifacts_dir)
        report['steps'].append({
            'step': 'collect',
            'action': 'Collected knowledge from artifacts',
            'result': f'{len(collected)} knowledge objects created'
        })
        
        # Step 2: Build relationships
        relationships = self.build_relationships()
        report['steps'].append({
            'step': 'relationships',
            'action': 'Built relationships between objects',
            'result': f'{len(relationships)} relationships created'
        })
        
        # Step 3: Discover patterns
        patterns = self.discover_patterns()
        report['steps'].append({
            'step': 'patterns',
            'action': 'Discovered patterns across objects',
            'result': f'{len(patterns)} patterns discovered'
        })
        
        # Step 4: Fuse knowledge
        fused = self.fuse_knowledge()
        report['steps'].append({
            'step': 'fuse',
            'action': 'Fused knowledge into higher-level concepts',
            'result': f'{len(fused)} fused knowledge objects created'
        })
        
        # Step 5: Build indexes
        index_paths = self.build_indexes()
        report['steps'].append({
            'step': 'indexes',
            'action': 'Built repository indexes',
            'result': f'{len(index_paths)} indexes created'
        })
        
        # Step 6: Build manifest
        manifest = self.build_manifest(index_paths)
        report['steps'].append({
            'step': 'manifest',
            'action': 'Built repository manifest',
            'result': f'{manifest["object_count"]} objects indexed'
        })
        
        # Step 7: Validate
        validation = self.validate()
        report['steps'].append({
            'step': 'validation',
            'action': 'Validated knowledge repository',
            'result': f"Valid: {validation['valid']}"
        })
        
        report['completed_at'] = datetime.utcnow().isoformat() + 'Z'
        report['summary'] = manifest
        report['validation'] = validation
        
        # Save report
        self._save_yaml(f"{self.root_dir}/materialization_report.yaml", report)
        
        return report


def demo():
    """Demo of Knowledge Layer materialization."""
    print("=" * 60)
    print("KDE KNOWLEDGE LAYER MATERIALIZATION")
    print("=" * 60)
    
    layer = KnowledgeLayer()
    
    print("\n📦 Materializing Knowledge Layer...")
    report = layer.materialize()
    
    print("\n📊 MATERIALIZATION REPORT:")
    for step in report['steps']:
        print(f"   ✅ {step['step']}: {step['result']}")
    
    print(f"\n📈 SUMMARY:")
    summary = report['summary']
    print(f"   Objects: {summary['object_count']}")
    print(f"   Patterns: {summary['pattern_count']}")
    print(f"   Relationships: {summary['relationship_count']}")
    print(f"   Fused: {summary['fused_count']}")
    print(f"   Avg Confidence: {summary['avg_confidence']}")
    
    print(f"\n✅ Repository Valid: {report['validation']['valid']}")
    
    print("\n" + "=" * 60)
    print("KNOWLEDGE LAYER MATERIALIZED")
    print("=" * 60)


if __name__ == "__main__":
    demo()

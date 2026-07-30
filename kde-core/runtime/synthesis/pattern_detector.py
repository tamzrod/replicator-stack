"""
Pattern Detector - Alpha Engine Implementation

Finds patterns in evidence/data.
Implements: KDE-ENGINE-001 (Alpha) specification.

ENGINE QUESTION: "What patterns exist?"
"""

import re
from collections import Counter
from typing import List, Dict, Any, Optional


class PatternDetector:
    """
    Detects patterns in evidence.
    
    Based on Alpha engine specification:
    - Collect evidence from sources
    - Find recurring elements
    - Calculate occurrence frequencies
    - Return validated patterns
    """
    
    def __init__(self):
        self.min_occurrence = 2
        self.confidence_threshold = 0.5
        
    def find_patterns(self, evidence: List[Any]) -> Dict[str, Any]:
        """
        Find patterns in evidence.
        
        Args:
            evidence: List of evidence items (strings, dicts, etc.)
            
        Returns:
            Dict with patterns, confidence, and metadata
        """
        # Step 1: Extract elements from evidence
        elements = self._extract_elements(evidence)
        
        # Step 2: Count occurrences
        frequency = Counter(elements)
        
        # Step 3: Filter by minimum occurrence
        candidates = {
            element: count 
            for element, count in frequency.items()
            if count >= self.min_occurrence
        }
        
        # Step 4: Calculate confidence
        patterns = []
        total = len(elements)
        
        for pattern, count in candidates.items():
            confidence = count / total if total > 0 else 0
            patterns.append({
                'pattern': pattern,
                'occurrences': count,
                'confidence': confidence,
                'is_significant': confidence >= self.confidence_threshold
            })
        
        # Step 5: Sort by confidence
        patterns.sort(key=lambda x: x['confidence'], reverse=True)
        
        return {
            'patterns': patterns,
            'total_evidence': len(evidence),
            'total_elements': len(elements),
            'patterns_found': len(patterns),
            'significant_patterns': len([p for p in patterns if p['is_significant']])
        }
    
    def _extract_elements(self, evidence: List[Any]) -> List[str]:
        """Extract individual elements from evidence."""
        elements = []
        
        for item in evidence:
            if isinstance(item, str):
                # Extract words
                words = re.findall(r'\b\w+\b', item.lower())
                elements.extend(words)
            elif isinstance(item, dict):
                # Extract values
                for value in item.values():
                    if isinstance(value, str):
                        words = re.findall(r'\b\w+\b', value.lower())
                        elements.extend(words)
                    elif isinstance(value, (int, float)):
                        elements.append(str(value))
            elif isinstance(item, (int, float)):
                elements.append(str(item))
                
        return elements
    
    def validate_pattern(self, pattern: str, evidence: List[Any]) -> Dict[str, Any]:
        """
        Validate a specific pattern against evidence.
        
        Args:
            pattern: Pattern to validate
            evidence: Evidence to validate against
            
        Returns:
            Validation result with confidence
        """
        elements = self._extract_elements(evidence)
        count = elements.count(pattern.lower())
        
        return {
            'pattern': pattern,
            'occurrences': count,
            'confidence': count / len(elements) if elements else 0,
            'is_valid': count >= self.min_occurrence
        }


def demonstrate_alpha_engine():
    """Demonstrate Alpha engine pattern detection."""
    
    print("=" * 60)
    print("ALPHA ENGINE DEMO: Pattern Detection")
    print("=" * 60)
    
    detector = PatternDetector()
    
    # Sample evidence (like chess moves, game data, etc.)
    evidence = [
        "queen sacrifice wins game",
        "queen sacrifice creates attack",
        "bishop sacrifice in endgame",
        "knight sacrifice in middlegame",
        "queen trade leads to advantage",
        "queen sacrifice in king hunt",
        "rook sacrifice for initiative",
        "queen attack on king side",
        "bishop trade simplifies position",
        "knight outpost in center",
        "queen pawn push creates threats",
        "queen sacrifice is aggressive",
        "bishop pair advantage in endgame",
        "knight is strong in closed positions",
    ]
    
    print("\n📥 Evidence Collected:")
    for e in evidence[:5]:
        print(f"  - {e}")
    print(f"  ... and {len(evidence)-5} more")
    
    print("\n🔍 Running Pattern Detection...")
    result = detector.find_patterns(evidence)
    
    print("\n✅ Patterns Found:")
    for p in result['patterns'][:5]:
        status = "✓" if p['is_significant'] else " "
        print(f"  {status} '{p['pattern']}': {p['occurrences']}x ({p['confidence']:.1%})")
    
    print(f"\n📊 Summary:")
    print(f"  Total evidence: {result['total_evidence']}")
    print(f"  Patterns found: {result['patterns_found']}")
    print(f"  Significant: {result['significant_patterns']}")
    
    return result


if __name__ == "__main__":
    demonstrate_alpha_engine()

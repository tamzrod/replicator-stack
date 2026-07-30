"""
Context Analyzer - Beta Engine Implementation

Finds context and boundaries for patterns.
Implements: KDE-ENGINE-002 (Beta) specification.

ENGINE QUESTION: "When does X apply? Where does X work?"
"""

import re
from typing import List, Dict, Any, Optional, Tuple
from collections import defaultdict


class ContextAnalyzer:
    """
    Analyzes patterns to find their context and boundaries.
    
    Based on Beta engine specification:
    - Takes patterns from Alpha
    - Finds WHEN patterns apply
    - Finds WHERE patterns apply
    - Identifies boundaries (when patterns stop working)
    - Calculates confidence
    """
    
    def __init__(self):
        self.context_indicators = [
            'when', 'during', 'in', 'against', 'after', 'before',
            'with', 'without', 'between', 'through', 'for', 'during'
        ]
        self.boundary_indicators = [
            'unless', 'except', 'but', 'not', 'never', 'without',
            'unless', 'until', 'outside', 'beyond'
        ]
        
    def analyze_context(self, pattern: str, evidence: List[str]) -> Dict[str, Any]:
        """
        Analyze a pattern to find its context.
        
        Args:
            pattern: The pattern to analyze
            evidence: Evidence where pattern appears
            
        Returns:
            Dict with context, boundaries, and confidence
        """
        # Step 1: Find co-occurring elements (context)
        context_elements = self._find_context(pattern, evidence)
        
        # Step 2: Identify boundaries (when pattern breaks)
        boundaries = self._find_boundaries(pattern, evidence)
        
        # Step 3: Calculate confidence
        confidence = self._calculate_confidence(
            pattern, context_elements, boundaries, evidence
        )
        
        # Step 4: Determine applicability
        applicability = self._determine_applicability(
            pattern, context_elements, boundaries
        )
        
        return {
            'pattern': pattern,
            'contexts': context_elements,
            'boundaries': boundaries,
            'confidence': confidence,
            'applicability': applicability,
            'when_true': self._format_when(pattern, context_elements),
            'when_false': self._format_when_false(boundaries)
        }
    
    def _find_context(self, pattern: str, evidence: List[str]) -> List[Dict[str, Any]]:
        """Find contextual elements that co-occur with pattern."""
        contexts = []
        
        for item in evidence:
            if pattern.lower() in item.lower():
                # Find words near pattern
                words = re.findall(r'\b\w+\b', item.lower())
                if pattern.lower() in words:
                    idx = words.index(pattern.lower())
                    
                    # Get surrounding words
                    start = max(0, idx - 3)
                    end = min(len(words), idx + 4)
                    window = words[start:end]
                    
                    # Find context indicators
                    for word in window:
                        if word != pattern.lower():
                            for indicator in self.context_indicators:
                                if indicator in window:
                                    contexts.append({
                                        'element': word,
                                        'indicator': indicator,
                                        'sentence': item
                                    })
        
        # Deduplicate and count
        element_counts = defaultdict(int)
        for ctx in contexts:
            element_counts[(ctx['element'], ctx['indicator'])] += 1
        
        return [
            {'element': el, 'indicator': ind, 'count': count}
            for (el, ind), count in element_counts.items()
            if count >= 1
        ][:10]  # Top 10
    
    def _find_boundaries(self, pattern: str, evidence: List[str]) -> List[str]:
        """Find boundaries where pattern stops applying."""
        boundaries = []
        
        for item in evidence:
            if pattern.lower() not in item.lower():
                # Check for boundary indicators
                for indicator in self.boundary_indicators:
                    if indicator in item.lower():
                        boundaries.append(f"{indicator}: {item[:100]}")
        
        # Deduplicate
        seen = set()
        unique = []
        for b in boundaries:
            key = b.split(':')[0] if ':' in b else b
            if key not in seen:
                seen.add(key)
                unique.append(b)
        
        return unique[:5]
    
    def _calculate_confidence(self, pattern: str, contexts: List, boundaries: List, evidence: List) -> float:
        """Calculate confidence that pattern has meaningful context."""
        if not contexts:
            return 0.0
            
        # Higher confidence if:
        # - Many context elements
        # - Few or no boundaries
        # - Pattern appears frequently
        
        base_confidence = min(len(contexts) * 0.1, 0.5)
        boundary_penalty = min(len(boundaries) * 0.1, 0.3)
        
        pattern_frequency = sum(1 for e in evidence if pattern.lower() in e.lower())
        frequency_bonus = min(pattern_frequency * 0.05, 0.2)
        
        confidence = base_confidence - boundary_penalty + frequency_bonus
        return max(0.0, min(1.0, confidence))
    
    def _determine_applicability(self, pattern: str, contexts: List, boundaries: List) -> str:
        """Determine overall applicability statement."""
        if not contexts:
            return "UNIVERSAL (no context found)"
        
        context_types = [c['indicator'] for c in contexts]
        
        if 'in' in context_types or 'against' in context_types:
            return "CONDITIONAL (specific situations)"
        elif 'after' in context_types or 'before' in context_types:
            return "TEMPORAL (timing-dependent)"
        elif 'with' in context_types or 'without' in context_types:
            return "DEPENDENT (requires conditions)"
        else:
            return "PARTIAL (limited context known)"
    
    def _format_when(self, pattern: str, contexts: List) -> str:
        """Format WHEN statement."""
        if not contexts:
            return f"'{pattern}' applies in general"
        
        elements = [c['element'] for c in contexts[:3]]
        return f"'{pattern}' applies {contexts[0]['indicator']} {', '.join(elements)}"
    
    def _format_when_false(self, boundaries: List) -> str:
        """Format WHEN NOT statement."""
        if not boundaries:
            return "Unknown (no boundaries identified)"
        
        return f"'{boundaries[0].split(':')[0]}' conditions"


def demonstrate_beta_engine():
    """Demonstrate Beta engine context analysis."""
    
    print("=" * 60)
    print("BETA ENGINE DEMO: Context Analysis")
    print("=" * 60)
    
    analyzer = ContextAnalyzer()
    
    # Evidence with context
    evidence = [
        "queen sacrifice wins in king hunt",
        "queen sacrifice wins against castled king",
        "queen sacrifice creates attack",
        "queen sacrifice is aggressive",
        "queen sacrifice works in middlegame",
        "bishop sacrifice in endgame is tricky",
        "knight sacrifice fails without preparation",
        "queen sacrifice wins with king exposure",
        "queen sacrifice against uncastled king",
        "rook sacrifice in time pressure",
    ]
    
    print("\n📥 Evidence Collected:")
    for e in evidence[:5]:
        print(f"  - {e}")
    print(f"  ... and {len(evidence)-5} more")
    
    print("\n🔍 Analyzing 'queen sacrifice' context...")
    result = analyzer.analyze_context("queen sacrifice", evidence)
    
    print("\n✅ Context Found:")
    for ctx in result['contexts'][:5]:
        print(f"  - {ctx['indicator']} {ctx['element']} ({ctx['count']}x)")
    
    print(f"\n📊 Analysis:")
    print(f"  Pattern: {result['pattern']}")
    print(f"  Confidence: {result['confidence']:.1%}")
    print(f"  Applicability: {result['applicability']}")
    print(f"  When true: {result['when_true']}")
    
    if result['boundaries']:
        print(f"  When false: {result['when_false']}")
    
    return result


if __name__ == "__main__":
    demonstrate_beta_engine()

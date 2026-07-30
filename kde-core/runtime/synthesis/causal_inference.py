"""
Causal Inference - Gamma Engine Implementation

Finds causal mechanisms.
Implements: KDE-ENGINE-003 (Gamma) specification.

ENGINE QUESTION: "How does X CAUSE Y? Why does X lead to Y?"
"""

import re
from typing import List, Dict, Any, Optional, Tuple
from collections import defaultdict


class CausalInference:
    """
    Infers causal mechanisms from patterns.
    
    Based on Gamma engine specification:
    - Takes contextual patterns from Beta
    - Identifies causal relationships
    - Finds mechanisms (HOW X leads to Y)
    - Predicts interventions
    """
    
    def __init__(self):
        self.causal_indicators = [
            'because', 'causes', 'leads to', 'results in', 
            'creates', 'forces', 'enables', 'produces',
            'due to', 'therefore', 'thus', 'hence'
        ]
        self.mechanism_words = [
            'by', 'through', 'via', 'mechanism', 'process',
            'action', 'effect', 'response', 'reaction'
        ]
        
    def find_causes(self, effect: str, evidence: List[str]) -> Dict[str, Any]:
        """
        Find causes for an effect.
        
        Args:
            effect: The effect to find causes for
            evidence: Evidence to analyze
            
        Returns:
            Dict with causes, mechanisms, and predictions
        """
        # Step 1: Find causal statements
        causal_statements = self._find_causal_statements(effect, evidence)
        
        # Step 2: Identify causes
        causes = self._identify_causes(effect, causal_statements)
        
        # Step 3: Find mechanisms
        mechanisms = self._find_mechanisms(effect, causal_statements)
        
        # Step 4: Analyze confounders
        confounders = self._analyze_confounders(effect, evidence)
        
        # Step 5: Predict interventions
        interventions = self._predict_interventions(effect, causes, mechanisms)
        
        # Step 6: Calculate confidence
        confidence = self._calculate_causal_confidence(
            causes, mechanisms, confounders
        )
        
        return {
            'effect': effect,
            'causes': causes,
            'mechanisms': mechanisms,
            'confounders': confounders,
            'interventions': interventions,
            'confidence': confidence,
            'hypothesis': self._format_hypothesis(effect, causes, mechanisms)
        }
    
    def _find_causal_statements(self, effect: str, evidence: List[str]) -> List[Dict[str, str]]:
        """Find statements that link cause and effect."""
        statements = []
        
        for item in evidence:
            item_lower = item.lower()
            effect_lower = effect.lower()
            
            if effect_lower in item_lower:
                # Check for causal indicators
                for indicator in self.causal_indicators:
                    if indicator in item_lower:
                        # Extract the cause part
                        idx = item_lower.find(indicator)
                        cause_part = item[:idx].strip()
                        
                        statements.append({
                            'statement': item,
                            'indicator': indicator,
                            'cause_part': cause_part,
                            'effect_part': item[idx:].strip()
                        })
                        break
        
        return statements
    
    def _identify_causes(self, effect: str, statements: List[Dict]) -> List[Dict[str, Any]]:
        """Identify causes from causal statements."""
        causes = []
        
        for stmt in statements:
            cause_text = stmt['cause_part']
            
            # Clean up
            cause_text = re.sub(r'^\s*(and|or|but|,)\s*', '', cause_text)
            cause_text = cause_text.strip(' .,:;')
            
            if cause_text and len(cause_text) > 3:
                causes.append({
                    'cause': cause_text,
                    'indicator': stmt['indicator'],
                    'evidence': stmt['statement']
                })
        
        # Deduplicate by cause text
        seen = set()
        unique = []
        for c in causes:
            key = c['cause'][:30]
            if key not in seen:
                seen.add(key)
                unique.append(c)
        
        return unique[:5]
    
    def _find_mechanisms(self, effect: str, statements: List[Dict]) -> List[str]:
        """Find mechanisms (HOW) from causal statements."""
        mechanisms = []
        
        for stmt in statements:
            text = stmt['statement'].lower()
            
            # Look for mechanism indicators
            for mechanism in self.mechanism_words:
                if mechanism in text:
                    # Extract surrounding context
                    idx = text.find(mechanism)
                    start = max(0, idx - 30)
                    end = min(len(text), idx + 50)
                    context = text[start:end]
                    
                    mechanisms.append(f"{mechanism}: {context.strip()}")
        
        # Deduplicate
        seen = set()
        unique = []
        for m in mechanisms:
            key = m.split(':')[0] if ':' in m else m[:20]
            if key not in seen:
                seen.add(key)
                unique.append(m)
        
        return unique[:3]
    
    def _analyze_confounders(self, effect: str, evidence: List[str]) -> List[str]:
        """Find potential confounding factors."""
        confounders = []
        
        for item in evidence:
            item_lower = item.lower()
            
            # Look for conditions that might confound
            confounder_indicators = ['unless', 'if', 'when', 'provided', 'assuming']
            for indicator in confounder_indicators:
                if indicator in item_lower and effect.lower() not in item_lower:
                    confounders.append(f"{indicator}: {item[:80]}...")
        
        return list(set(confounders))[:3]
    
    def _predict_interventions(self, effect: str, causes: List, mechanisms: List) -> List[Dict[str, str]]:
        """Predict outcomes of interventions."""
        interventions = []
        
        for cause in causes[:3]:
            interventions.append({
                'if_you': f"Increase or enable '{cause['cause']}'",
                'then': f"'{effect}' is more likely",
                'confidence': cause.get('indicator', 'unknown') in self.causal_indicators
            })
            
            interventions.append({
                'if_you': f"Remove or disable '{cause['cause']}'",
                'then': f"'{effect}' is less likely",
                'confidence': cause.get('indicator', 'unknown') in self.causal_indicators
            })
        
        return interventions[:4]
    
    def _calculate_causal_confidence(self, causes: List, mechanisms: List, confounders: List) -> float:
        """Calculate confidence in causal relationship."""
        # Higher with:
        # - Multiple causes
        # - Identified mechanisms
        # - Few confounders
        
        cause_score = min(len(causes) * 0.2, 0.4)
        mechanism_score = min(len(mechanisms) * 0.15, 0.3)
        confounder_penalty = min(len(confounders) * 0.1, 0.2)
        
        confidence = cause_score + mechanism_score - confounder_penalty
        return max(0.0, min(1.0, confidence))
    
    def _format_hypothesis(self, effect: str, causes: List, mechanisms: List) -> str:
        """Format causal hypothesis."""
        if not causes:
            return f"'{effect}' has unknown causes"
        
        cause = causes[0]['cause']
        
        if mechanisms:
            mechanism = mechanisms[0].split(':')[0]
            return f"'{cause}' {mechanism} '{effect}'"
        else:
            return f"'{cause}' leads to '{effect}'"


def demonstrate_gamma_engine():
    """Demonstrate Gamma engine causal inference."""
    
    print("=" * 60)
    print("GAMMA ENGINE DEMO: Causal Inference")
    print("=" * 60)
    
    inferrer = CausalInference()
    
    # Evidence with causal statements
    evidence = [
        "queen sacrifice creates attack because it forces king movement",
        "queen sacrifice leads to advantage by opening lines",
        "queen sacrifice wins because king becomes exposed",
        "bishop sacrifice loses due to material imbalance",
        "queen sacrifice creates tactical threats via pin",
        "knight sacrifice gains initiative by diverting defender",
        "queen trade results in simplification because both queens off",
    ]
    
    print("\n📥 Evidence Collected:")
    for e in evidence:
        print(f"  - {e}")
    
    print("\n🔍 Finding causes for 'queen sacrifice wins'...")
    result = inferrer.find_causes("queen sacrifice wins", evidence)
    
    print("\n✅ Causes Identified:")
    for cause in result['causes']:
        print(f"  - {cause['indicator']} {cause['cause']}")
    
    print("\n⚙️ Mechanisms:")
    for mech in result['mechanisms']:
        print(f"  - {mech}")
    
    print("\n🎯 Intervention Predictions:")
    for interv in result['interventions'][:2]:
        print(f"  - If: {interv['if_you']}")
        print(f"    Then: {interv['then']}")
    
    print(f"\n📊 Confidence: {result['confidence']:.1%}")
    print(f"💡 Hypothesis: {result['hypothesis']}")
    
    return result


if __name__ == "__main__":
    demonstrate_gamma_engine()

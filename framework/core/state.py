import json
from typing import Dict


class AgentState:
    """Tracks the internal state of an agent."""
    
    def __init__(
        self,
        confidence: float = 0.5,
        energy: float = 0.5,
        cooperation: float = 0.5,
        mood: float = 0.5
    ):
        """
        Initialize agent state with normalized values (0.0 to 1.0).
        
        Args:
            confidence: Agent's confidence level (0.0 = low, 1.0 = high)
            energy: Agent's energy level (0.0 = exhausted, 1.0 = energized)
            cooperation: Agent's cooperation level (0.0 = uncooperative, 1.0 = highly cooperative)
            mood: Agent's mood (0.0 = negative, 1.0 = positive)
        """
        self._confidence = self._clamp(confidence)
        self._energy = self._clamp(energy)
        self._cooperation = self._clamp(cooperation)
        self._mood = self._clamp(mood)
    
    @staticmethod
    def _clamp(value: float) -> float:
        """
        Clamp a value to the range [0.0, 1.0].
        
        Args:
            value: The value to clamp
            
        Returns:
            Clamped value between 0.0 and 1.0
        """
        return max(0.0, min(1.0, value))
    
    # Getters
    @property
    def confidence(self) -> float:
        """Get current confidence level."""
        return self._confidence
    
    @property
    def energy(self) -> float:
        """Get current energy level."""
        return self._energy
    
    @property
    def cooperation(self) -> float:
        """Get current cooperation level."""
        return self._cooperation
    
    @property
    def mood(self) -> float:
        """Get current mood."""
        return self._mood
    
    # Setters
    def set_confidence(self, value: float) -> None:
        """
        Set confidence to an absolute value (auto-clamped to [0.0, 1.0]).
        
        Args:
            value: New confidence value
        """
        self._confidence = self._clamp(value)
    
    def set_energy(self, value: float) -> None:
        """
        Set energy to an absolute value (auto-clamped to [0.0, 1.0]).
        
        Args:
            value: New energy value
        """
        self._energy = self._clamp(value)
    
    def set_cooperation(self, value: float) -> None:
        """
        Set cooperation to an absolute value (auto-clamped to [0.0, 1.0]).
        
        Args:
            value: New cooperation value
        """
        self._cooperation = self._clamp(value)
    
    def set_mood(self, value: float) -> None:
        """
        Set mood to an absolute value (auto-clamped to [0.0, 1.0]).
        
        Args:
            value: New mood value
        """
        self._mood = self._clamp(value)
    
    # Adjusters (delta updates)
    def adjust_confidence(self, delta: float) -> None:
        """
        Adjust confidence by a relative amount (auto-clamped to [0.0, 1.0]).
        
        Args:
            delta: Amount to add (can be negative)
        """
        self._confidence = self._clamp(self._confidence + delta)
    
    def adjust_energy(self, delta: float) -> None:
        """
        Adjust energy by a relative amount (auto-clamped to [0.0, 1.0]).
        
        Args:
            delta: Amount to add (can be negative)
        """
        self._energy = self._clamp(self._energy + delta)
    
    def adjust_cooperation(self, delta: float) -> None:
        """
        Adjust cooperation by a relative amount (auto-clamped to [0.0, 1.0]).
        
        Args:
            delta: Amount to add (can be negative)
        """
        self._cooperation = self._clamp(self._cooperation + delta)
    
    def adjust_mood(self, delta: float) -> None:
        """
        Adjust mood by a relative amount (auto-clamped to [0.0, 1.0]).
        
        Args:
            delta: Amount to add (can be negative)
        """
        self._mood = self._clamp(self._mood + delta)
    
    # Serialization methods
    def to_dict(self) -> Dict[str, float]:
        """
        Convert state to a dictionary.
        
        Returns:
            Dictionary with state values
        """
        return {
            'confidence': self._confidence,
            'energy': self._energy,
            'cooperation': self._cooperation,
            'mood': self._mood
        }
    
    def to_json(self) -> str:
        """
        Convert state to a JSON string.
        
        Returns:
            JSON string representation of state
        """
        return json.dumps(self.to_dict())
    
    @classmethod
    def from_dict(cls, data: Dict[str, float]) -> "AgentState":
        """
        Create an AgentState from a dictionary.
        
        Args:
            data: Dictionary containing state values
            
        Returns:
            New AgentState instance
        """
        return cls(
            confidence=data.get('confidence', 0.5),
            energy=data.get('energy', 0.5),
            cooperation=data.get('cooperation', 0.5),
            mood=data.get('mood', 0.5)
        )
    
    @classmethod
    def from_json(cls, json_str: str) -> "AgentState":
        """
        Create an AgentState from a JSON string.
        
        Args:
            json_str: JSON string containing state values
            
        Returns:
            New AgentState instance
        """
        data = json.loads(json_str)
        return cls.from_dict(data)
    
    def reset(self) -> None:
        """Reset all state values to default (0.5)."""
        self._confidence = 0.5
        self._energy = 0.5
        self._cooperation = 0.5
        self._mood = 0.5
    
    def __repr__(self) -> str:
        return (
            f"AgentState(confidence={self._confidence:.2f}, "
            f"energy={self._energy:.2f}, "
            f"cooperation={self._cooperation:.2f}, "
            f"mood={self._mood:.2f})"
        )
    
    def __str__(self) -> str:
        return self.__repr__()


from typing import List, Dict, Optional, Union
from .personality import Personality
from .state import AgentState


class PersonalityAgent:
    """
    Base class for personality-driven agents.
    
    Combines personality, state, and conversation management.
    """
    
    def __init__(
        self,
        personality: Union[str, Personality],
        agent_id: Optional[str] = None,
        initial_state: Optional[AgentState] = None,
        max_history: int = 50
    ):
        """
        Initialize a PersonalityAgent.
        
        Args:
            personality: Either a personality key (str) to load from config,
                        or a Personality instance
            agent_id: Optional unique identifier for this agent
            initial_state: Optional initial state. If None, creates default state
            max_history: Maximum number of messages to keep in history (default: 50)
        """
        # Load or set personality
        if isinstance(personality, str):
            self.personality = Personality.from_config(personality)
        else:
            self.personality = personality
        
        # Set agent ID
        self.agent_id = agent_id or f"agent_{self.personality.name.lower().replace(' ', '_')}"
        
        # Initialize state
        self.state = initial_state or AgentState()
        
        # Conversation history (OpenAI message format)
        self._conversation_history: List[Dict[str, str]] = []
        
        # Max history setting
        self._max_history = max_history
    
    def add_message(self, role: str, content: str) -> None:
        """
        Add a message to the conversation history.
        
        Args:
            role: Message role ('system', 'user', 'assistant')
            content: Message content
        """
        self._conversation_history.append({
            "role": role,
            "content": content
        })
        
        # Trim history if exceeds max (keep system messages)
        if len(self._conversation_history) > self._max_history:
            # Keep system messages and most recent messages
            system_messages = [msg for msg in self._conversation_history if msg["role"] == "system"]
            other_messages = [msg for msg in self._conversation_history if msg["role"] != "system"]
            
            # Keep only the most recent (max_history - system messages) messages
            keep_count = self._max_history - len(system_messages)
            other_messages = other_messages[-keep_count:]
            
            self._conversation_history = system_messages + other_messages
    
    def get_conversation_history(self) -> List[Dict[str, str]]:
        """
        Get the full conversation history.
        
        Returns:
            List of message dictionaries
        """
        return self._conversation_history.copy()
    
    def clear_history(self) -> None:
        """Clear all conversation history."""
        self._conversation_history.clear()
    
    def generate_system_prompt(self) -> str:
        """
        Generate a comprehensive system prompt combining personality and state.
        
        Returns:
            System prompt string for the LLM
        """
        # Get base personality prompt
        personality_prompt = self.personality.generate_personality_prompt()
        
        # Add state information
        state_description = self._generate_state_description()
        
        # Combine into full system prompt
        system_prompt = f"""{personality_prompt}

---

Current Internal State:
{state_description}

Take your current state into account when responding. Your confidence, energy, cooperation, and mood should subtly influence your communication style and decision-making."""
        
        return system_prompt
    
    def _generate_state_description(self) -> str:
        """
        Generate a human-readable description of the current state.
        
        Returns:
            State description string
        """
        def state_label(value: float) -> str:
            """Convert normalized value to descriptive label."""
            if value >= 0.8:
                return "Very High"
            elif value >= 0.6:
                return "High"
            elif value >= 0.4:
                return "Moderate"
            elif value >= 0.2:
                return "Low"
            else:
                return "Very Low"
        
        return f"""- Confidence: {state_label(self.state.confidence)} ({self.state.confidence:.2f})
- Energy: {state_label(self.state.energy)} ({self.state.energy:.2f})
- Cooperation: {state_label(self.state.cooperation)} ({self.state.cooperation:.2f})
- Mood: {state_label(self.state.mood)} ({self.state.mood:.2f})"""
    
    def get_context_for_llm(self, include_system_prompt: bool = True) -> List[Dict[str, str]]:
        """
        Get formatted context for LLM API calls.
        
        Args:
            include_system_prompt: Whether to include/update the system prompt
            
        Returns:
            List of messages formatted for LLM API
        """
        if include_system_prompt:
            # Generate fresh system prompt with current state
            system_prompt = self.generate_system_prompt()
            
            # Remove old system messages from history
            non_system_messages = [msg for msg in self._conversation_history if msg["role"] != "system"]
            
            # Return system prompt + conversation
            return [{"role": "system", "content": system_prompt}] + non_system_messages
        else:
            return self._conversation_history.copy()
    
    def update_state_from_interaction(
        self,
        confidence_delta: float = 0.0,
        energy_delta: float = 0.0,
        cooperation_delta: float = 0.0,
        mood_delta: float = 0.0
    ) -> None:
        """
        Update agent state based on an interaction.
        
        Args:
            confidence_delta: Change in confidence
            energy_delta: Change in energy
            cooperation_delta: Change in cooperation
            mood_delta: Change in mood
        """
        if confidence_delta != 0.0:
            self.state.adjust_confidence(confidence_delta)
        if energy_delta != 0.0:
            self.state.adjust_energy(energy_delta)
        if cooperation_delta != 0.0:
            self.state.adjust_cooperation(cooperation_delta)
        if mood_delta != 0.0:
            self.state.adjust_mood(mood_delta)
    
    def reset_state(self) -> None:
        """Reset agent state to default values."""
        self.state.reset()
    
    def to_dict(self) -> Dict:
        """
        Serialize agent to dictionary.
        
        Returns:
            Dictionary representation of agent
        """
        return {
            "agent_id": self.agent_id,
            "personality": {
                "name": self.personality.name,
                "archetype": self.personality.archetype.value,
                "traits": self.personality.traits,
                "description": self.personality.description
            },
            "state": self.state.to_dict(),
            "conversation_history": self._conversation_history.copy(),
            "max_history": self._max_history
        }
    
    def __repr__(self) -> str:
        return (
            f"PersonalityAgent(id='{self.agent_id}', "
            f"personality='{self.personality.name}', "
            f"archetype={self.personality.archetype.value}, "
            f"messages={len(self._conversation_history)})"
        )


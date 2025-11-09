from typing import List, Dict, Optional, Callable
import time
from datetime import datetime
from ..core import PersonalityAgent
from ..llm import LLMAdapter, LLMResponse


class ConversationTurn:
    """Represents a single turn in the conversation."""
    
    def __init__(
        self,
        agent_id: str,
        agent_name: str,
        content: str,
        round_number: int,
        timestamp: Optional[datetime] = None
    ):
        """
        Initialize a conversation turn.
        
        Args:
            agent_id: Unique agent identifier
            agent_name: Agent's personality name
            content: The content/response from the agent
            round_number: Which round this turn belongs to
            timestamp: When this turn occurred (defaults to now)
        """
        self.agent_id = agent_id
        self.agent_name = agent_name
        self.content = content
        self.round_number = round_number
        self.timestamp = timestamp or datetime.now()
    
    def to_dict(self) -> Dict:
        """Convert turn to dictionary."""
        return {
            "agent_id": self.agent_id,
            "agent_name": self.agent_name,
            "content": self.content,
            "round_number": self.round_number,
            "timestamp": self.timestamp.isoformat()
        }


class ChorusFramework:
    """
    Main orchestrator for multi-agent conversations.
    
    Manages agent registration, turn-taking, state updates, and conversation flow.
    """
    
    def __init__(
        self,
        llm_adapter: LLMAdapter,
        max_rounds: int = 10,
        verbose: bool = True,
        auto_update_state: bool = True
    ):
        """
        Initialize the Chorus framework.
        
        Args:
            llm_adapter: LLM adapter instance to use for all agents
            max_rounds: Maximum number of conversation rounds (default: 10)
            verbose: Whether to display conversation in real-time (default: True)
            auto_update_state: Whether to auto-update agent states (default: True)
        """
        self.llm_adapter = llm_adapter
        self.max_rounds = max_rounds
        self.verbose = verbose
        self.auto_update_state = auto_update_state
        
        # Agent management
        self._agents: List[PersonalityAgent] = []
        self._agent_map: Dict[str, PersonalityAgent] = {}
        
        # Conversation tracking
        self._conversation_history: List[ConversationTurn] = []
        self._current_round = 0
        self._total_tokens_used = 0
        
        # Initial context/topic
        self._initial_prompt: Optional[str] = None
    
    def register_agent(self, agent: PersonalityAgent) -> None:
        """
        Register an agent to participate in conversations.
        
        Args:
            agent: PersonalityAgent instance to register
            
        Raises:
            ValueError: If agent ID already registered
        """
        if agent.agent_id in self._agent_map:
            raise ValueError(f"Agent with ID '{agent.agent_id}' is already registered")
        
        self._agents.append(agent)
        self._agent_map[agent.agent_id] = agent
        
        if self.verbose:
            print(f"✓ Registered agent: {agent.agent_id} ({agent.personality.name})")
    
    def unregister_agent(self, agent_id: str) -> None:
        """
        Remove an agent from the conversation.
        
        Args:
            agent_id: ID of agent to remove
            
        Raises:
            ValueError: If agent ID not found
        """
        if agent_id not in self._agent_map:
            raise ValueError(f"Agent with ID '{agent_id}' not found")
        
        agent = self._agent_map[agent_id]
        self._agents.remove(agent)
        del self._agent_map[agent_id]
        
        if self.verbose:
            print(f"✓ Unregistered agent: {agent_id}")
    
    def get_agents(self) -> List[PersonalityAgent]:
        """Get list of all registered agents."""
        return self._agents.copy()
    
    def set_initial_prompt(self, prompt: str) -> None:
        """
        Set the initial prompt/topic to seed the conversation.
        
        Args:
            prompt: The conversation starter or context
        """
        self._initial_prompt = prompt
    
    def run_conversation(
        self,
        rounds: Optional[int] = None,
        stop_condition: Optional[Callable[[List[ConversationTurn]], bool]] = None
    ) -> List[ConversationTurn]:
        """
        Run the multi-agent conversation.
        
        Args:
            rounds: Number of rounds to run (overrides max_rounds if provided)
            stop_condition: Optional function that returns True to stop early
            
        Returns:
            List of conversation turns
            
        Raises:
            ValueError: If no agents registered or no initial prompt set
        """
        if not self._agents:
            raise ValueError("No agents registered. Use register_agent() first.")
        
        if not self._initial_prompt:
            raise ValueError("No initial prompt set. Use set_initial_prompt() first.")
        
        num_rounds = rounds or self.max_rounds
        
        if self.verbose:
            self._display_header()
        
        # Add initial prompt to all agents
        for agent in self._agents:
            agent.add_message("user", self._initial_prompt)
        
        # Run conversation rounds
        for round_num in range(1, num_rounds + 1):
            self._current_round = round_num
            
            if self.verbose:
                self._display_round_start(round_num)
            
            # Each agent takes a turn (round-robin)
            for agent in self._agents:
                turn = self._process_agent_turn(agent, round_num)
                self._conversation_history.append(turn)
                
                # Share this agent's response with other agents
                self._broadcast_turn(turn, exclude_agent_id=agent.agent_id)
                
                if self.verbose:
                    self._display_turn(turn, agent)
                
                # Small delay for readability
                if self.verbose:
                    time.sleep(0.3)
            
            # Check stop condition
            if stop_condition and stop_condition(self._conversation_history):
                if self.verbose:
                    print("\n⏹ Stop condition met. Ending conversation.\n")
                break
        
        if self.verbose:
            self._display_summary()
        
        return self._conversation_history.copy()
    
    def _process_agent_turn(
        self,
        agent: PersonalityAgent,
        round_num: int
    ) -> ConversationTurn:
        """
        Process a single agent's turn.
        
        Args:
            agent: The agent taking the turn
            round_num: Current round number
            
        Returns:
            ConversationTurn object
        """
        # Get context for LLM (includes system prompt with current state)
        messages = agent.get_context_for_llm(include_system_prompt=True)
        
        # Generate response (using default temperature for the model)
        response: LLMResponse = self.llm_adapter.generate(
            messages=messages
        )
        
        # Track tokens
        if response.tokens_used:
            self._total_tokens_used += response.tokens_used
        
        # Add response to agent's history
        agent.add_message("assistant", response.content)
        
        # Update agent state if enabled
        if self.auto_update_state:
            self._update_agent_state(agent, response)
        
        # Create turn record
        turn = ConversationTurn(
            agent_id=agent.agent_id,
            agent_name=agent.personality.name,
            content=response.content,
            round_number=round_num
        )
        
        return turn
    
    def _broadcast_turn(self, turn: ConversationTurn, exclude_agent_id: str) -> None:
        """
        Broadcast a turn to all other agents.
        
        Args:
            turn: The turn to broadcast
            exclude_agent_id: Don't send to this agent (the speaker)
        """
        for agent in self._agents:
            if agent.agent_id != exclude_agent_id:
                # Add as user message from the perspective of other agents
                message = f"[{turn.agent_name}]: {turn.content}"
                agent.add_message("user", message)
    
    def _update_agent_state(self, agent: PersonalityAgent, response: LLMResponse) -> None:
        """
        Auto-update agent state based on interaction.
        
        Simple heuristic-based updates. Can be overridden for more sophisticated logic.
        
        Args:
            agent: Agent whose state to update
            response: The LLM response
        """
        # Small energy decrease per turn (agents get tired)
        agent.state.adjust_energy(-0.02)
        
        # Slight confidence boost for completing a turn
        agent.state.adjust_confidence(0.01)
        
        # Adjust based on response length (longer = more engaged)
        if len(response.content) > 200:
            agent.state.adjust_cooperation(0.01)
            agent.state.adjust_mood(0.01)
    
    def get_conversation_history(self) -> List[ConversationTurn]:
        """Get the full conversation history."""
        return self._conversation_history.copy()
    
    def get_conversation_as_dict(self) -> List[Dict]:
        """Get conversation history as list of dictionaries."""
        return [turn.to_dict() for turn in self._conversation_history]
    
    def reset(self) -> None:
        """Reset the framework for a new conversation."""
        self._conversation_history.clear()
        self._current_round = 0
        self._total_tokens_used = 0
        self._initial_prompt = None
        
        # Clear agent histories
        for agent in self._agents:
            agent.clear_history()
            agent.reset_state()
        
        if self.verbose:
            print("✓ Framework reset. Ready for new conversation.\n")
    
    # Display formatting methods
    
    def _display_header(self) -> None:
        """Display conversation header."""
        print("\n" + "=" * 80)
        print("🎭 CHORUS FRAMEWORK - Multi-Agent Conversation".center(80))
        print("=" * 80)
        print(f"\nParticipants: {len(self._agents)} agents")
        for agent in self._agents:
            print(f"  • {agent.personality.name} ({agent.personality.archetype.value})")
        print(f"\nTopic: {self._initial_prompt}")
        print(f"Max Rounds: {self.max_rounds}")
        print("\n" + "-" * 80 + "\n")
    
    def _display_round_start(self, round_num: int) -> None:
        """Display round start marker."""
        print(f"\n{'─' * 80}")
        print(f"Round {round_num}".center(80))
        print(f"{'─' * 80}\n")
    
    def _display_turn(self, turn: ConversationTurn, agent: PersonalityAgent) -> None:
        """Display a single turn with agent info."""
        # Agent header
        print(f"🤖 {turn.agent_name} ({agent.personality.archetype.value})")
        print(f"   State: C:{agent.state.confidence:.2f} | "
              f"E:{agent.state.energy:.2f} | "
              f"Co:{agent.state.cooperation:.2f} | "
              f"M:{agent.state.mood:.2f}")
        
        # Content
        print(f"\n   {turn.content}\n")
    
    def _display_summary(self) -> None:
        """Display conversation summary."""
        print("\n" + "=" * 80)
        print("📊 CONVERSATION SUMMARY".center(80))
        print("=" * 80)
        print(f"\nTotal Rounds: {self._current_round}")
        print(f"Total Turns: {len(self._conversation_history)}")
        print(f"Total Tokens Used: {self._total_tokens_used}")
        print("\nFinal Agent States:")
        for agent in self._agents:
            print(f"\n  {agent.personality.name}:")
            print(f"    Confidence: {agent.state.confidence:.2f}")
            print(f"    Energy: {agent.state.energy:.2f}")
            print(f"    Cooperation: {agent.state.cooperation:.2f}")
            print(f"    Mood: {agent.state.mood:.2f}")
        print("\n" + "=" * 80 + "\n")
    
    def __repr__(self) -> str:
        return (
            f"ChorusFramework(agents={len(self._agents)}, "
            f"rounds={self._current_round}/{self.max_rounds}, "
            f"turns={len(self._conversation_history)})"
        )


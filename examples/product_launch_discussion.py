"""
Example: AI Product Launch Strategy Discussion

This example demonstrates how multiple agents with different personalities
collaborate to discuss launching a new AI-powered productivity tool.

Agents involved:
- Strategic Leader: Provides vision and direction
- Data Scientist: Offers data-driven insights
- Creative Innovator: Brings unique perspectives
- Devil's Advocate: Challenges assumptions and identifies risks
"""

import os
import sys
import json
from pathlib import Path

# Add parent directory to path so we can import framework
sys.path.insert(0, str(Path(__file__).parent.parent))

# Import framework components
from framework import (
    PersonalityAgent,
    OpenAIAdapter,
    ChorusFramework,
)


def main():
    """Run the product launch strategy discussion."""
    
    print("🎭 Chorus Framework - Product Launch Strategy Example\n")
    
    # Check for API key
    if not os.getenv("OPENAI_API_KEY"):
        print("❌ Error: OPENAI_API_KEY environment variable not set")
        print("Please set your OpenAI API key:")
        print("  export OPENAI_API_KEY='your-api-key-here'\n")
        return
    
    # 1. Initialize the LLM adapter
    print("📡 Initializing LLM adapter (gpt-5-nano)...")
    llm_adapter = OpenAIAdapter(model="gpt-5-nano")
    
    # 2. Create the Chorus Framework
    print("🎼 Creating Chorus Framework...")
    framework = ChorusFramework(
        llm_adapter=llm_adapter,
        max_rounds=4,  # 4 rounds of discussion
        verbose=True,  # Display conversation in real-time
        auto_update_state=True  # Track agent state changes
    )
    
    # 3. Create agents with different personalities
    print("\n👥 Creating agents with diverse personalities...\n")
    
    # Strategic leader - drives vision and decisions
    leader = PersonalityAgent(
        personality="strategic_leader",
        agent_id="leader_001"
    )
    
    # Data analyst - provides data-driven insights
    analyst = PersonalityAgent(
        personality="data_scientist",
        agent_id="analyst_001"
    )
    
    # Creative innovator - brings fresh perspectives
    innovator = PersonalityAgent(
        personality="innovation_catalyst",
        agent_id="innovator_001"
    )
    
    # Critical thinker - challenges assumptions
    critic = PersonalityAgent(
        personality="critical_thinker",
        agent_id="critic_001"
    )
    
    # 4. Register agents with the framework
    framework.register_agent(leader)
    framework.register_agent(analyst)
    framework.register_agent(innovator)
    framework.register_agent(critic)
    
    # 5. Define the problem statement
    problem_statement = """
We're planning to launch a new AI-powered productivity tool that helps 
knowledge workers organize their tasks, emails, and notes intelligently. 

The tool uses machine learning to:
- Automatically categorize and prioritize tasks
- Suggest optimal work schedules
- Surface relevant information at the right time

We need to decide on:
1. Target market segment (startups, enterprises, freelancers?)
2. Pricing strategy (freemium, subscription, enterprise?)
3. Launch timeline and key milestones
4. Primary marketing channels

Let's discuss our strategy. What are your thoughts on how we should 
approach this launch?
""".strip()
    
    framework.set_initial_prompt(problem_statement)
    
    # 6. Run the conversation
    print("\n🚀 Starting conversation...\n")
    
    try:
        conversation_history = framework.run_conversation(rounds=4)
        
        # 7. Display key insights
        print("\n💡 KEY INSIGHTS FROM THE DISCUSSION")
        print("=" * 80)
        
        # Analyze each agent's contributions
        for agent in framework.get_agents():
            agent_turns = [
                turn for turn in conversation_history 
                if turn.agent_id == agent.agent_id
            ]
            
            print(f"\n{agent.personality.name} ({len(agent_turns)} contributions):")
            print(f"  Final State: Confidence={agent.state.confidence:.2f}, "
                  f"Energy={agent.state.energy:.2f}")
            
            # Show first contribution as example
            if agent_turns:
                first_turn = agent_turns[0].content[:150]
                print(f"  First insight: {first_turn}...")
        
        # 8. Export conversation to JSON
        output_dir = Path(__file__).parent / "output"
        output_dir.mkdir(exist_ok=True)
        
        output_file = output_dir / "product_launch_conversation.json"
        
        conversation_data = {
            "problem_statement": problem_statement,
            "agents": [
                {
                    "id": agent.agent_id,
                    "name": agent.personality.name,
                    "archetype": agent.personality.archetype.value,
                    "final_state": agent.state.to_dict()
                }
                for agent in framework.get_agents()
            ],
            "conversation": framework.get_conversation_as_dict(),
            "metrics": {
                "total_rounds": framework._current_round,
                "total_turns": len(conversation_history),
                "total_tokens": framework._total_tokens_used
            }
        }
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(conversation_data, f, indent=2, ensure_ascii=False)
        
        print(f"\n💾 Conversation saved to: {output_file}")
        
        # 9. Summary statistics
        print("\n📈 CONVERSATION STATISTICS")
        print("=" * 80)
        print(f"Total Rounds: {framework._current_round}")
        print(f"Total Turns: {len(conversation_history)}")
        print(f"Total Tokens Used: {framework._total_tokens_used}")
        print(f"Average Tokens per Turn: {framework._total_tokens_used / len(conversation_history):.1f}")
        
        # State analysis
        avg_confidence = sum(a.state.confidence for a in framework.get_agents()) / len(framework.get_agents())
        avg_energy = sum(a.state.energy for a in framework.get_agents()) / len(framework.get_agents())
        
        print(f"\nAverage Agent Confidence: {avg_confidence:.2f}")
        print(f"Average Agent Energy: {avg_energy:.2f}")
        
        print("\n✅ Example completed successfully!\n")
        
    except Exception as e:
        print(f"\n❌ Error during conversation: {e}\n")
        raise


if __name__ == "__main__":
    main()


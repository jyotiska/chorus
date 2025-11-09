"""
Example: Quick App Naming Decision

This example demonstrates a fast-paced decision-making session where agents
provide short, focused contributions to choose an app name and tagline.

Agents involved:
- Strategic Leader: Provides direction and final decision-making
- Data Scientist: Offers market data insights
- Creative Innovator: Proposes unique naming ideas
- Devil's Advocate: Questions choices and identifies risks
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
    """Run the quick app naming decision."""
    
    print("🎭 Chorus Framework - Quick App Naming Example\n")
    
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
        max_rounds=3,  # Just 3 quick rounds
        verbose=True,
        auto_update_state=True
    )
    
    # 3. Create agents with different personalities
    print("\n👥 Creating agents...\n")
    
    leader = PersonalityAgent(
        personality="strategic_leader",
        agent_id="leader_001"
    )
    
    analyst = PersonalityAgent(
        personality="data_scientist",
        agent_id="analyst_001"
    )
    
    innovator = PersonalityAgent(
        personality="innovation_catalyst",
        agent_id="innovator_001"
    )
    
    critic = PersonalityAgent(
        personality="critical_thinker",
        agent_id="critic_001"
    )
    
    # 4. Register agents
    framework.register_agent(leader)
    framework.register_agent(analyst)
    framework.register_agent(innovator)
    framework.register_agent(critic)
    
    # 5. Short, focused problem statement
    problem_statement = """
We need to finalize the name and tagline for our new AI productivity app. 
The app helps busy professionals manage tasks, emails, and schedules intelligently. 
Suggest a memorable name and a punchy tagline (max 6 words each).

IMPORTANT: Keep your responses to 2-3 sentences maximum. Be concise and focused.
""".strip()
    
    framework.set_initial_prompt(problem_statement)
    
    # 6. Run the conversation
    print("\n🚀 Starting quick decision session...\n")
    print("=" * 80)
    
    try:
        conversation_history = framework.run_conversation(rounds=3)
        
        # 7. Display the decision summary
        print("\n" + "=" * 80)
        print("📋 DECISION SUMMARY")
        print("=" * 80)
        
        # Show final contributions
        print("\n💡 Final Round Contributions:\n")
        final_round = max(turn.round_number for turn in conversation_history)
        final_turns = [turn for turn in conversation_history if turn.round_number == final_round]
        
        for turn in final_turns:
            print(f"• {turn.agent_name}:")
            print(f"  {turn.content}\n")
        
        # 8. Export to JSON
        output_dir = Path(__file__).parent / "output"
        output_dir.mkdir(exist_ok=True)
        
        output_file = output_dir / "quick_app_naming.json"
        
        conversation_data = {
            "problem_statement": problem_statement,
            "agents": [
                {
                    "id": agent.agent_id,
                    "name": agent.personality.name,
                    "archetype": agent.personality.archetype.value,
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
        
        print(f"💾 Conversation saved to: {output_file}")
        
        # 9. Quick stats
        print("\n📈 SESSION STATS")
        print("=" * 80)
        print(f"Rounds: {framework._current_round}")
        print(f"Total Turns: {len(conversation_history)}")
        print(f"Tokens Used: {framework._total_tokens_used}")
        
        print("\n✅ Quick decision session completed!\n")
        
    except Exception as e:
        print(f"\n❌ Error during conversation: {e}\n")
        raise


if __name__ == "__main__":
    main()


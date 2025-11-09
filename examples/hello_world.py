"""
Simple Hello World Example

This minimal example shows the basic usage of the Chorus Framework
with just two agents having a brief conversation.
"""

import os
import sys
from pathlib import Path

# Add parent directory to path so we can import framework
sys.path.insert(0, str(Path(__file__).parent.parent))

from framework import PersonalityAgent, OpenAIAdapter, ChorusFramework


def main():
    """Run a simple two-agent conversation."""
    
    # Check for API key
    if not os.getenv("OPENAI_API_KEY"):
        print("Error: Please set OPENAI_API_KEY environment variable")
        return
    
    # Initialize LLM and framework
    llm = OpenAIAdapter(model="gpt-5-nano")
    framework = ChorusFramework(llm, max_rounds=2, verbose=True)
    
    # Create two agents
    leader = PersonalityAgent("strategic_leader")
    creative = PersonalityAgent("innovation_catalyst")
    
    # Register agents
    framework.register_agent(leader)
    framework.register_agent(creative)
    
    # Set conversation topic
    framework.set_initial_prompt(
        "What's the most important skill for AI engineers in 2025?"
    )
    
    # Run conversation
    framework.run_conversation()
    
    print("\n✅ Hello World example complete!")


if __name__ == "__main__":
    main()


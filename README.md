# Chorus Framework

A modular Python framework for orchestrating multi-agent conversations with personality-driven AI agents.

## Overview

The Chorus Framework enables you to create sophisticated multi-agent discussions where AI agents with distinct personalities collaborate, debate, and solve problems together. Each agent has unique traits, behavioral patterns, and maintains internal state throughout conversations.

**Perfect for:**

- Group decision-making simulations
- Brainstorming sessions with diverse perspectives
- Product strategy discussions
- Design reviews and critiques
- Any scenario requiring multiple viewpoints

## Key Features

**Rich Personality System**

- 8 built-in personality archetypes (Leader, Analyst, Creative, Facilitator, Contrarian, etc.)
- Custom personality definitions via YAML configuration
- Behavioral traits that influence agent responses

**Dynamic State Management**

- Agents track confidence, energy, cooperation, and mood
- State evolves naturally during conversations
- Influences communication style and decision-making

**Flexible LLM Integration**

- Abstract adapter pattern for any LLM provider
- Built-in OpenAI support (GPT-4, GPT-5-nano, etc.)
- Easy to extend for Claude, local models, etc.

**Smart Orchestration**

- Round-based conversation flow
- Automatic turn-taking between agents
- Conversation history management
- Token usage tracking

## Project Structure

```
chorus/
├── framework/                      # Main framework package
│   ├── core/                      # Core agent components
│   │   ├── agent.py               # PersonalityAgent base class
│   │   ├── personality.py         # Personality and Archetype system
│   │   ├── personalities.yaml     # Personality configurations
│   │   └── state.py               # AgentState management
│   ├── llm/                       # LLM integration layer
│   │   ├── adapter.py             # Abstract LLM adapter interface
│   │   └── openai_adapter.py     # OpenAI implementation
│   ├── orchestration/             # Conversation orchestration
│   │   └── framework.py           # ChorusFramework orchestrator
│   └── utils/                     # Utility functions
├── examples/                       # Example scripts
│   ├── hello_world.py             # Minimal 2-agent conversation
│   ├── quick_app_naming.py        # Fast decision-making (short responses)
│   ├── product_launch_discussion.py  # Complex strategy discussion
│   └── output/                    # Exported conversation logs
├── tests/                          # Test suite
│   └── unit/                      # Unit tests
├── requirements.txt                # Python dependencies
└── README.md                       # This file
```

## Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd chorus
   ```

2. **Install dependencies**

   ```bash
   pip install -r requirements.txt
   ```

3. **Set up your OpenAI API key**
   ```bash
   export OPENAI_API_KEY='your-api-key-here'
   ```

## Quick Start

### Basic Example

```python
from framework import PersonalityAgent, OpenAIAdapter, ChorusFramework

# Initialize LLM adapter
llm = OpenAIAdapter(model="gpt-5-nano")

# Create the framework
framework = ChorusFramework(llm, max_rounds=3, verbose=True)

# Create agents with different personalities
leader = PersonalityAgent("strategic_leader")
creative = PersonalityAgent("innovation_catalyst")

# Register agents
framework.register_agent(leader)
framework.register_agent(creative)

# Set conversation topic
framework.set_initial_prompt("What's the future of AI-powered productivity tools?")

# Run the conversation
conversation = framework.run_conversation()
```

### Run the Examples

**1. Hello World** - Basic two-agent conversation

```bash
python examples/hello_world.py
```

**2. Quick App Naming** - Fast-paced decision making with short responses

```bash
python examples/quick_app_naming.py
```

**3. Product Launch Discussion** - Complex multi-agent strategy session

```bash
python examples/product_launch_discussion.py
```

See `examples/README.md` for detailed documentation of each example.

## Available Personalities

The framework includes 8 pre-configured personalities:

| Personality               | Archetype  | Traits                                 | Best For                      |
| ------------------------- | ---------- | -------------------------------------- | ----------------------------- |
| `strategic_leader`        | Leader     | Decisive, goal-oriented, confident     | Direction and decision-making |
| `data_scientist`          | Analytical | Logical, methodical, precise           | Data-driven insights          |
| `innovation_catalyst`     | Creative   | Bold, experimental, unconventional     | Creative solutions            |
| `team_facilitator`        | Support    | Empathetic, collaborative, diplomatic  | Team harmony                  |
| `critical_thinker`        | Contrarian | Skeptical, questioning, rigorous       | Risk identification           |
| `pragmatic_engineer`      | Analytical | Practical, efficient, systematic       | Implementation focus          |
| `visionary_strategist`    | Leader     | Strategic, forward-thinking, inspiring | Long-term planning            |
| `creative_problem_solver` | Creative   | Adaptive, resourceful, versatile       | Novel approaches              |

See `framework/core/personalities.yaml` to customize or add new personalities.

## Core Concepts

### Agents

Each `PersonalityAgent` has:

- A distinct **personality** with traits and behaviors
- Internal **state** (confidence, energy, cooperation, mood)
- **Conversation history** for context
- System prompt generation based on personality + state

### Orchestration

The `ChorusFramework` manages:

- Agent registration and turn-taking
- Conversation rounds and flow control
- State updates after each turn
- Message broadcasting between agents
- Token usage tracking

### State Management

Agent state values (0.0 - 1.0) influence behavior:

- **Confidence**: Certainty in opinions
- **Energy**: Engagement level
- **Cooperation**: Willingness to collaborate
- **Mood**: Positive/negative sentiment

## Extending the Framework

### Add a New LLM Provider

```python
from framework.llm import LLMAdapter, LLMResponse

class CustomLLMAdapter(LLMAdapter):
    def generate(self, messages, **kwargs) -> LLMResponse:
        # Your implementation
        pass

    def generate_stream(self, messages, **kwargs):
        # Streaming implementation
        pass
```

### Create Custom Personalities

Edit `framework/core/personalities.yaml`:

```yaml
personalities:
  my_personality:
    name: "My Custom Personality"
    archetype: "leader" # or: analytical, creative, support, contrarian
    traits:
      - "trait1"
      - "trait2"
    description: "Detailed personality description..."
```

Then use it:

```python
agent = PersonalityAgent("my_personality")
```

## Development

### Run Tests

```bash
pytest
```

### Code Quality

```bash
# Format code
black .
isort .

# Type checking
mypy framework/
```

## Use Cases

- **Product Strategy**: Simulate stakeholder discussions
- **Brainstorming**: Generate diverse ideas from multiple perspectives
- **Design Reviews**: Get feedback from different roles
- **Decision Analysis**: Explore pros/cons with devil's advocates
- **Education**: Demonstrate multi-perspective thinking
- **Game NPCs**: Create believable character interactions

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - See LICENSE file for details

## Acknowledgments

Built for creating more dynamic and insightful AI conversations.

---

**Questions or feedback?** Open an issue or start a discussion!

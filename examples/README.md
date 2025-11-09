# Chorus Framework Examples

This directory contains example scripts demonstrating various features of the Chorus Framework.

## Prerequisites

Before running any examples, make sure you have:

1. Installed dependencies:

   ```bash
   pip install -r ../requirements.txt
   ```

2. Set your OpenAI API key:
   ```bash
   export OPENAI_API_KEY='your-api-key-here'
   ```

## Available Examples

### 1. Hello World (`hello_world.py`)

**Difficulty**: Beginner  
**Runtime**: ~30 seconds  
**Description**: A minimal example with two agents discussing a simple topic.

**What it demonstrates**:

- Basic framework setup
- Creating agents from personality configs
- Running a short conversation

**Run it**:

```bash
python examples/hello_world.py
```

---

### 2. Quick App Naming (`quick_app_naming.py`)

**Difficulty**: Beginner  
**Runtime**: ~30-45 seconds  
**Description**: Fast-paced decision session where agents provide short, focused suggestions for an app name and tagline.

**What it demonstrates**:

- Concise, punchy agent responses (2-3 sentences each)
- Quick decision-making process
- Custom instructions per agent
- Diverse perspectives in minimal time

**Agents involved**:

- Strategic Leader - Decisive and action-oriented
- Data Scientist - Data-driven insights
- Creative Innovator - Bold and creative ideas
- Critical Thinker - Points out risks

**Run it**:

```bash
python examples/quick_app_naming.py
```

**Output**:

- Console: Fast-paced conversation with decision summary
- File: `examples/output/quick_app_naming.json`

---

### 3. Product Launch Discussion (`product_launch_discussion.py`)

**Difficulty**: Intermediate  
**Runtime**: ~2-3 minutes  
**Description**: Four agents with diverse personalities collaborate on a comprehensive AI product launch strategy.

**What it demonstrates**:

- Multiple agents with different archetypes
- Complex problem-solving scenario
- Detailed, in-depth discussions
- State tracking across conversation
- Exporting conversation to JSON
- Statistical analysis of the discussion

**Agents involved**:

- Strategic Leader - Provides vision and direction
- Data Scientist - Offers data-driven insights
- Creative Innovator - Brings unique perspectives
- Devil's Advocate - Challenges assumptions

**Run it**:

```bash
python examples/product_launch_discussion.py
```

**Output**:

- Console: Real-time conversation display with agent states
- File: `examples/output/product_launch_conversation.json`

---

## Understanding the Output

### Console Display

The examples show:

- **Agent names** and their personality archetypes
- **Agent states** (Confidence, Energy, Cooperation, Mood)
- **Conversation content** from each agent's turn
- **Summary statistics** at the end

### State Values

All state values range from 0.0 to 1.0:

- **Confidence**: How certain the agent is
- **Energy**: How engaged/tired the agent is
- **Cooperation**: Willingness to collaborate
- **Mood**: Positive to negative sentiment

### JSON Export

The product launch example exports a JSON file containing:

```json
{
  "problem_statement": "...",
  "agents": [...],
  "conversation": [...],
  "metrics": {
    "total_rounds": 4,
    "total_turns": 16,
    "total_tokens": 5234
  }
}
```

## Creating Your Own Examples

To create a new example:

1. Import the framework:

   ```python
   from framework import PersonalityAgent, OpenAIAdapter, ChorusFramework
   ```

2. Initialize components:

   ```python
   llm = OpenAIAdapter()
   framework = ChorusFramework(llm, max_rounds=3)
   ```

3. Create and register agents:

   ```python
   agent = PersonalityAgent("strategic_leader")
   framework.register_agent(agent)
   ```

4. Set topic and run:
   ```python
   framework.set_initial_prompt("Your topic here")
   framework.run_conversation()
   ```

## Available Personalities

You can create agents with these built-in personalities:

- `strategic_leader` - Decisive, goal-oriented leader
- `data_scientist` - Logical, analytical thinker
- `innovation_catalyst` - Creative, experimental innovator
- `team_facilitator` - Collaborative, supportive facilitator
- `critical_thinker` - Skeptical, challenging contrarian
- `pragmatic_engineer` - Practical, solution-focused engineer
- `visionary_strategist` - Strategic, forward-thinking leader
- `creative_problem_solver` - Resourceful, adaptive thinker

See `framework/core/personalities.yaml` for full details.

## Troubleshooting

**"OpenAI API key not set"**

- Make sure you've exported `OPENAI_API_KEY` in your shell
- Or add it to your `.env` file

**"No agents registered"**

- Ensure you call `framework.register_agent()` before running

**Rate limit errors**

- The framework uses gpt-5-nano by default (cost-effective)
- Add delays between runs if needed
- Check your OpenAI usage limits

## Next Steps

After running these examples:

1. Modify the problem statements to fit your use case
2. Experiment with different agent combinations
3. Adjust the number of rounds
4. Create custom personalities in `personalities.yaml`
5. Build your own orchestration logic

Happy collaborating!

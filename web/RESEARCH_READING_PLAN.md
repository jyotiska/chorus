# Chorus: an eight-week research reading plan

**Focus:** Multi-agent AI behavior, group decision-making, dissent, evidence use, simulation validity, and evaluation.  
**Pace:** Approximately 4–6 hours per week. Read the first two items in each week closely; use the remaining items selectively, then do the small Chorus exercise.  
**Outcome:** A concrete, testable research proposal grounded in the current prototype.

**Currency:** Refreshed on 7 October 2026. The first readings in most weeks emphasize 2025–2026 research; older papers and methods are marked as foundations. This is a curated path through work most relevant to Chorus, not an exhaustive or permanently current bibliography. I distinguish published research from preprints where that matters.

## Implementation context

This reading plan was written for the October 2026 prototype. Its exercises and implementation references are historical; the readings have not been re-reviewed in the repository merge.

The current application has a Python engine, persistent SQLite records, an integrated browser interface and separate app-building and checked-benchmark flows. Start with the [main README](../README.md), [architecture](../docs/chorus-architecture.md) and [contributor guide](../CONTRIBUTING.md) when mapping an exercise to today's code.

## Week 1 — What is an agent system?

**Question:** Which behaviors come from a model, and which come from the code that organizes its calls?

1. **Research article, 2026:** [Capable language models can outgrow the benefits of collaboration — Kim et al.](https://www.nature.com/articles/s42256-026-01268-y). A useful current starting point: when do multiple agents help under matched compute budgets, and when do they add coordination cost?
2. **Engineering article, 2024:** [Building effective agents — Anthropic](https://www.anthropic.com/engineering/building-effective-agents). Distinguish fixed workflows, agent loops, tools, and evaluation criteria.
3. **Foundational papers, selective:** [CAMEL — Li et al.](https://arxiv.org/abs/2303.17760) and [AutoGen — Wu et al.](https://arxiv.org/abs/2308.08155). Compare their role and conversation designs with Chorus; read introductions and architecture sections rather than both papers end to end.
4. **Video, optional:** [Tips for building AI agents — Anthropic](https://www.youtube.com/watch?v=LP5OCa20Zpg).

**Try in Chorus:** Trace one run from scenario JSON to the browser turn loop, server prompt, Ollama response, and canvas action. Label each choice as *code-controlled*, *model-generated*, or *user-selected*.

**Keep:** A one-page system map and three testable claims about the current app.

## Week 2 — Agent simulation and its limits

**Question:** When does believable role play tell us something useful about social behavior?

1. **Research article, 2026:** [Towards operational validation of LLM-agent social simulations — Tomašević et al.](https://link.springer.com/article/10.1140/epjds/s13688-026-00674-x). Examine repeated runs against real comparison data and the places where a plausible simulation still diverges.
2. **Position paper, 2026:** [AI Agents Alone Are Not (Yet) Sufficient for Social Simulation — Li and Tao](https://arxiv.org/abs/2603.00113). Separate fluent dialogue from validated social modeling, including exposure and scheduling assumptions.
3. **Foundational papers, selective:** [Generative Agents — Park et al.](https://arxiv.org/abs/2304.03442) and [Concordia — Vezhnevets et al.](https://arxiv.org/abs/2312.03664). Compare memory, planning, and explicit environment design.
4. **Video, optional:** [Generative Agents — Joon Sung Park](https://www.youtube.com/watch?v=XY5Wncq5vAE).

**Try in Chorus:** Read `data/sessions/architecture_review.json` alongside the live code. Mark each architectural claim as implemented, scenario fiction, or an untested hypothesis.

**Keep:** A short validity memo stating what conclusions a Chorus run can and cannot support.

## Week 3 — Groups, information, and conformity

**Question:** Why can a group sound confident while losing its best evidence?

1. **Conference paper, 2026:** [SILO-BENCH: Distributed coordination under information silos — Zhang et al.](https://aclanthology.org/2026.acl-long.1354/). Study the gap between agents communicating often and actually solving a problem whose information is distributed.
2. **Conference paper, 2025:** [An Empirical Study of Group Conformity in Multi-Agent Systems — Choi et al.](https://aclanthology.org/2025.findings-acl.265/). Look at how group size and apparent agent ability shift stances.
3. **Human-group foundations:** [Asch on social pressure](https://web.mit.edu/curhan/www/docs/Articles/15341_Readings/Influence_Compliance/Asch_1955_Opinions_and_social_pressure.pdf), [Stasser and Titus on unshared information](https://www.uni-muenster.de/imperia/md/content/psyifp/aeechterhoff/vorlesungkommunikation/stasser_titus_unsharedinfogroupdisc_jpsp1985.pdf), and [Woolley et al. on collective intelligence](https://pubmed.ncbi.nlm.nih.gov/20929725/). Use these to form hypotheses about LLM groups; do not assume direct transfer.
4. **Video, optional:** [Optimizing Collective Intelligence — Anita Woolley](https://www.youtube.com/watch?v=-qg4tS1-8qY).

**Try in Chorus:** Use `murder_mystery` or `fermi_estimation`. Write independent answers before discussion, then record which distinctive facts and objections appear in the final canvas. A genuine hidden-profile experiment would need private evidence assigned to different agents, which Chorus does not yet provide.

**Keep:** An observation sheet for unique evidence, dissent, speaking share, and final correctness.

## Week 4 — Debate, dissent, and sycophancy

**Question:** Does discussion correct errors, or make an incorrect majority harder to resist?

1. **Preprint, 2026:** [Not All Flips Are Conformity — Hao et al.](https://arxiv.org/abs/2606.00820). Its self-reflection controls separate ordinary answer instability from conformity and evidence-driven persuasion. This is especially important before labeling Chorus position changes.
2. **Preprint, 2026:** [Easier to Mislead Than to Correct — Qu et al.](https://arxiv.org/abs/2606.01637). Compare harmful and beneficial revisions under peer agreement and authority cues.
3. **Controlled study, 2025:** [Can LLM Agents Really Debate? — Wu et al.](https://arxiv.org/abs/2511.07784). Compare team diversity, speaking order, confidence visibility, and majority pressure.
4. **Foundations, selective:** [Multiagent Debate — Du et al.](https://arxiv.org/abs/2305.14325) gives the positive case; [Towards Understanding Sycophancy — Sharma et al.](https://arxiv.org/abs/2310.13548) connects agreement pressure to model behavior.
5. **Very recent preprint, optional:** [Beyond Symmetric Agents: Cognitive Diversity and Multi-Agent Debate in Small Language Models — Ferreira et al.](https://arxiv.org/abs/2609.35875). Read its budget-matched comparisons and context-overflow check; treat its September 2026 findings as provisional.

**Try in Chorus:** On a question with a checkable answer, compare one independent solver, several independent solvers aggregated without discussion, and a Chorus discussion. Keep the model and total call budget as comparable as possible. Repeat a no-peer self-reflection condition so answer flips are not automatically counted as conformity.

**Keep:** Examples of discussion adding useful information, merely repeating an answer, or increasing confidence without increasing accuracy.

## Week 5 — Memory, context, and persona

**Question:** What does an agent actually use from a long transcript?

1. **Conference paper, 2026:** [How Memory Management Impacts LLM Agents — Xiong et al.](https://aclanthology.org/2026.acl-long.27/). Read about error propagation through stored experiences and why memory quality matters.
2. **Benchmark preprint, 2026:** [GroupMemBench: Memory in Multi-Party Conversations — Yang et al.](https://www.microsoft.com/en-us/research/publication/groupmembench-benchmarking-llm-agent-memory-in-multi-party-conversations/). Study speaker-grounded beliefs, knowledge updates, and ambiguous terms; relevant to a future persistent Chorus.
3. **Foundational papers:** [Lost in the Middle — Liu et al.](https://arxiv.org/abs/2307.03172) on fact position and [LoCoMo — Maharana et al.](https://arxiv.org/abs/2402.17753) on long-range conversational memory.
4. **Survey, optional:** [Memory Mechanisms of LLM-based Agents — Zhang et al.](https://arxiv.org/abs/2404.13501). Map alternatives to passing the entire discussion on every turn.

**Try in Chorus:** In one controlled scenario, place the same decisive fact early, in the middle, or late in the context. Hold other wording fixed. Score both whether the final decision recalls the fact and whether it uses the fact correctly.

**Keep:** A prompt-position test plan with separate recall and correct-use measures.

## Week 6 — Design experiments you can trust

**Question:** How do you turn interesting transcripts into reproducible evidence?

1. **Methods guide:** [Choosing an experimental design — NIST](https://www.itl.nist.gov/div898/handbook/pri/section3/pri3.htm). Focus on factors, randomization, replication, and blocking.
2. **Engineering guide:** [Demystifying evals for AI agents — Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents). Study trials, traces, deterministic checks, model graders, and human review.
3. **Methods book, selective:** [Causal Inference: What If — Hernán and Robins](https://miguelhernan.org/whatifbook), especially Chapters 1–3. Practice defining an intervention and comparison before interpreting effects.
4. **Video, optional:** [Evals for AI Agents — Anthropic webinar](https://claude.com/resources/webinars/evals-for-ai-agents-how-product-builders-get-the-most-out-of-every-new-model). This on-demand webinar may require registration.

**Try in Chorus:** Preregister a 2×2 comparison: Judge on/off × short/long run. Fix the scenarios and model, randomize run order, repeat each condition, and choose the primary outcome before seeing results.

**Keep:** A protocol specifying the unit of analysis, controls, number of trials, rubric, and stopping rule.

## Week 7 — Judges, oversight, and human correction

**Question:** Who checks the checker, especially when the Judge uses the same selected model?

1. **Paper accepted to Findings of EMNLP 2026:** [Beyond Consensus: Downward Bias and Role Asymmetry in Multi-Agent LLM Judges — Song et al.](https://arxiv.org/abs/2608.30373). A current warning that judges agreeing with one another need not match human assessments of subjective work.
2. **Paper, 2024:** [On scalable oversight with weak LLMs judging strong LLMs — Kenton et al.](https://arxiv.org/abs/2407.04622). Examine when debate or consultancy helps a less capable judge.
3. **Foundational evaluation paper:** [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena — Zheng et al.](https://arxiv.org/abs/2306.05685). Learn about position, verbosity, and self-enhancement biases.
4. **Video course, optional:** [Evaluating AI Agents — DeepLearning.AI](https://www.deeplearning.ai/courses/evaluating-ai-agents). Use its practical material on agent traces and evaluation.

**Try in Chorus:** Grade saved final canvases blindly with a fixed human rubric and compare those scores with Chorus’s final letter grades. In a separate judge test, swap the order and author labels of two outputs.

**Keep:** A judge audit with concrete disagreements and an independent outcome score.

## Week 8 — Incentives and a research agenda

**Question:** What changes when an agent optimizes a score instead of the intended task?

1. **Preprint, 2026:** [Reward Hacking in Language Model Agents: Revisiting AI Safety Gridworlds — Çağatan and Zhao](https://arxiv.org/abs/2606.15385). Study how a high visible score can diverge from the hidden objective in controlled language-agent tasks.
2. **Research article, 2026:** [Capable language models can outgrow the benefits of collaboration — Kim et al.](https://www.nature.com/articles/s42256-026-01268-y). Revisit its matched-budget baselines before choosing an incentive or coordination experiment.
3. **Research blogs, foundations:** [Specification gaming — Google DeepMind](https://deepmind.google/blog/specification-gaming-the-flip-side-of-ai-ingenuity/) and [Reward tampering — Anthropic](https://www.anthropic.com/research/reward-tampering/). Use the examples to identify proxy objectives in Chorus.
4. **Critical reading, optional:** [Take caution in using LLMs as human surrogates](https://pmc.ncbi.nlm.nih.gov/articles/PMC12184514/) and the original [AI Safety Gridworlds](https://arxiv.org/abs/1711.09883).

**Try in Chorus:** Draft three future experiments: one on dissent, one on human intervention, and one on incentives. For each, state the baseline, manipulation, observable outcome, and a result that would change your view.

**Keep:** A ranked research agenda and a two-page preregistration for the first experiment.

## Rules of thumb throughout

- Measure **individual correctness**, **group agreement**, and **final canvas quality** separately. Agreement is not the same as a good decision.
- Treat an agent's spoken explanation as an observable output, not privileged access to an internal belief or reasoning process.
- Record the exact prompts, scenario version, agent profiles, actual model used, turn count, Judge setting, transcript, canvas versions, tool actions, failures, and scoring rubric. Chorus does not persist runs yet, so save these manually until a run recorder exists.
- Repeat conditions and report null results as well as successes. A striking single transcript is a useful lead, not a reliable estimate of an effect.
- Use human social-psychology findings to generate hypotheses for AI-agent experiments. Test whether those hypotheses transfer.

*Research refreshed and links checked on 7 October 2026. New preprints can be useful leads, but their findings need replication and comparison with published work.*

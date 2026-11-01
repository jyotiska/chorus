# Chorus agent context and caching plan

Date: 1 November 2026

Status: Implementation proposal

Source baseline: Chorus commit `7fe2cf0`

External model routing: GPT through direct OpenAI; all other models through OpenRouter.

## Implementation status

Stage 1 is implemented: provider cache usage normalization, stable participant instruction prefixes, direct GPT cache controls, OpenRouter session affinity, a durable metadata-only attempt ledger, regenerated shared contracts and reply-level usage/context displays in both frontends. Reply metrics and whole-turn totals are separate. The initial release keeps the existing 32,768 Chorus context cap and marks missing or estimated values explicitly.

Validation diagnostics now distinguish rejected attempts from validated edits discarded with a skipped slot. Rejection feedback is recorded without draft text; brief replies receive measured length feedback and a shorter target. Skipped turns show aggregate cached input and context from the last attempted spoken response. Historical rejection reasons remain unavailable.

The isolated [1 November cache pilot](cache-pilot-2026-11-01.json) verified direct GPT reads of 2,266 cached tokens out of 2,281 input tokens and an OpenRouter/DeepSeek read of 2,304 out of 2,433. One later DeepSeek call missed, so these observations establish working cache reads rather than a guaranteed hit rate or full-session savings.

Stages 2–5 remain planned: durable per-agent message histories, caching of that growing history with broader route capabilities, compaction and the advanced session/observer inspector. Per-call costs are currently displayed when reported; automatic price reconciliation and broader workload cost comparisons remain follow-up work.

## Objective

Give every agent a durable conversation that grows with new events. Preserve unchanged prompt prefixes for provider caching, and compact older material explicitly before the working context fills. Chorus should own the conversation record across providers, pauses and restarts.

The fix has three parts:

1. **Persistent history** provides continuity for each agent.
2. **Provider caching** reuses computation for unchanged prompt prefixes.
3. **Compaction** bounds the active context while retaining the complete record in storage.

Caching does not expand the context window. With stateless APIs, Chorus still sends the necessary history; a provider cache can reduce the work needed to process it. OpenAI response chains also continue to bill historical input tokens. See [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state).

The pricing benefit comes from **cached input processing**, not from replaying a cached answer. Each agent should still generate a fresh response. Keep OpenRouter's separate whole-response cache disabled for experiments using `X-OpenRouter-Cache: false`. See [OpenRouter response caching](https://openrouter.ai/docs/guides/features/response-caching).

## Current behavior

The source inspection found that newer public messages already reach agents through a rebuilt transcript. The missing capability is a durable, incrementally extended conversation per agent.

### History exists but is flattened

`transcript()` includes all committed public turns. Each generation phase rebuilds a system message and a large user message. Earlier assistant replies are not maintained as an ordered conversation.

Source: [prompts.py](../chorus/services/prompts.py), especially `transcript()`, `canvas_messages()` and `spoken_messages()`.

### Changing content disrupts reusable prefixes

Turn counters, mood, energy and confidence appear in early instructions. Current canvas contents and phase instructions also change between calls. These changes make reuse of a long, identical prefix harder.

Source: [prompts.py](../chorus/services/prompts.py).

### One conservative limit governs every model

The transport uses a fixed 32,768 context budget and estimates input from UTF-8 bytes plus per-message overhead. This is distinct from actual token usage. There is no context compaction, and a context-limit error prevents resume.

Sources: [transport.py](../chorus/llm/transport.py), [sessions.py](../chorus/services/sessions.py).

### Cache behavior is invisible

OpenAI and OpenRouter adapters preserve total input/output usage but discard cache breakdowns. The current logs cannot establish whether caching occurs or how much it saves.

Sources: [openai.py](../chorus/llm/openai.py), [openrouter.py](../chorus/llm/openrouter.py).

### Agent contexts are not persisted

SQLite stores sessions, full snapshots, journals and commands. There are no per-agent context cursors or persisted prompt histories.

Source: [storage](../chorus/storage/__init__.py).

### Observer journals are intentionally isolated

Observer journals are never supplied to participants or judges. Reusing them as agent memory would change the experiment and reveal information that was previously excluded.

Sources: [prompts.py](../chorus/services/prompts.py), [architecture documentation](chorus-architecture.md).

## Scope

Use exactly two external routes:

- GPT models through the direct OpenAI Responses adapter.
- Every other external model through OpenRouter, including DeepSeek, MiniMax, GLM and any future Claude or Gemini selections.

Do not add a direct DeepSeek adapter or other direct external integrations. Preserve existing local Ollama compatibility for development and tests; new paid-provider cache work targets the two routes above.

Retain the current single-model session configuration. Per-agent model assignment can use the same design later without being a prerequisite.

Cross-session learning, vector retrieval, answer caching and automatic model substitution are separate features. They are not required to fix conversation continuity and context exhaustion.

## Recommended caching strategy

Make provider-side prompt caching a first implementation milestone. It does not need to wait for the complete per-agent persistence migration: even a locally rebuilt request can reuse provider computation if its serialized prefix stays identical. Persisted histories make that property easier to preserve and audit.

### Organize requests around reusable prefixes

Use three logical regions:

```text
Stable prefix
  Phase rules, scenario evidence, persona and fixed schema/tool definitions

Growing reusable history
  Earlier messages and accepted outputs, unchanged and in original order

New suffix
  Newly visible events, current document/state and the immediate task
```

Keep counters, timestamps, energy, confidence and other changing fields out of the stable prefix. Stabilize role order, whitespace, schema serialization, tool order and generation settings within a phase. Compare actual provider payloads, because schemas and tools can affect the provider's rendered prefix too.

Target both the stable prefix and the growing history. The history will usually become the larger repeated input in a long session. Avoid repeatedly regenerating summaries or rewriting old messages to represent the same events.

Treat cache breakpoint selection separately from message contents: preserve the bytes of old content, and place supported cache markers at useful reusable boundaries. Verify the provider's lookup and breakpoint limits when advancing a marker. Do not assume retaining a logical event ID is sufficient for a cache hit.

Each agent and generation phase must retain its own continuation identity. Reuse it across that agent's turns and retries; do not use the per-call `run_id` as a cache identity. Rotate identities on an explicit context epoch or model/policy change. Cache identifiers never replace recipient visibility checks.

### Preserve useful caches without increasing work

Prefer reuse within the natural session cadence. Do not send keepalive calls, pad prompts with filler, or purchase longer retention automatically. Choose retention based on observed gaps between an agent's turns and the expected number of subsequent reads.

Keep compaction threshold-based. A compacted prompt can be cheaper overall even when it loses a warm cache, so compare total request cost and capacity rather than maximizing the cache-hit percentage alone.

Cross-agent reuse of an identical public prefix is a possible later optimization. First establish reliable reuse within each agent and phase; private instructions and different schemas must never be combined merely to improve caching.

## Proposed architecture

### 1. Chorus owns durable state

The canonical session record remains the source of truth. Per-agent contexts are derived from that record and persisted so the exact messages used in earlier calls are reproducible.

The request flow is:

```text
Committed session events
    → Recipient visibility filter
    → Agent history and context budget
    → Provider adapter
    → Validated candidate output
    → Atomic publication and context commit
```

A provider conversation or cache is an optional acceleration layer. Correctness must survive a cold cache or provider restart.

### 2. Persist a context for each agent and phase

Key context records by:

- Session ID.
- Participant ID.
- Generation phase, initially canvas or speech.
- Context epoch, incremented when compaction replaces older history.

Reserve a branch identity for future forks. Each record should retain:

- Prompt, context-policy and model versions.
- Last consumed event ID.
- Immutable rendered messages and accepted assistant outputs.
- References to the source events represented by those messages.
- Summary contents and covered event ranges, if compacted.
- Exact request hash and optional provider continuation metadata.

Use a monotonic event ID separate from `turnNumber`: judge entries can share a participant turn number. Keep the existing session revision and operation guards for atomic commits.

Use normalized context/event tables with references rather than copying every agent's complete history into every public snapshot.

### 3. Append messages without rewriting earlier history

Use this request order:

1. Stable rules, persona and scenario evidence.
2. Frozen summary anchor for the current epoch, if present.
3. Preserved earlier messages and accepted replies.
4. Newly visible events in event order.
5. Current state, exact current canvas and this phase's task.

Append new material instead of rebuilding earlier messages. Keep dynamic state, turn counters and current work at the end. Keep schemas and their serialization stable within each phase.

This follows the [OpenAI guidance on preserving conversation history and stable prefixes](https://developers.openai.com/api/docs/guides/prompt-caching).

### 4. Keep canvas and speech histories distinct

Canvas and speech share the same permitted event source but maintain separate stable histories. This avoids alternating JSON-edit and prose instructions at the front of one conversation.

Each phase history records its actual accepted output as assistant content. In the speech history, the agent's own accepted speech stays an assistant reply. Peers and published judge feedback arrive as attributed, delimited user/event messages, never as system instructions.

Deduplicate by event ID so an agent's accepted reply is not also repeated as the same public event in that history. The canvas history can receive the agent's published speech as an attributed event when it was not already represented there.

Preserve historical task messages to keep prefixes stable. Label document versions so historical snapshots cannot be mistaken for the current canvas. Supply the exact current canvas and heading index when editing, even if that repeats data. Compaction should remove stale copies with older history.

### 5. Commit context and public work together

For each participant turn:

1. Read the committed session revision and relevant agent contexts.
2. Stage unseen permitted events and the current task.
3. Generate and validate the canvas operation and spoken contribution.
4. Stage accepted assistant outputs.
5. Commit context updates with the accepted turn and document under the existing revision and operation checks.

If speech is skipped, discard its candidate edit and staged assistant outputs. Publish the skip as a canonical system event for subsequent calls.

Rejected drafts and retry corrections remain attempt records; they must not become durable participant memory. Pause, cancellation, timeout or a stale operation discards staged updates. Late provider results cannot mutate committed state.

A provider may bill a request whose response was lost. Record uncertain attempts and permit a retry without promising exactly-once provider execution.

### 6. Preserve journal and judge boundaries

Observer journals remain separate observer output. Do not feed them back even to their author under the existing policy. Any future private working memory for agents requires a separate, versioned feature.

Judges receive an independent public-only context and the exact current canvas. Judge compaction needs its own declared policy because it can affect evaluation results.

Exact request and response records should live behind an observer access boundary, rather than in public snapshots or ordinary application logs.

## Context budgets and compaction

### Model-aware budgets

Replace the universal context limit with a model capability registry. For each route, record supported context size, maximum output, reasoning behavior, token counting and cache controls.

Calculate usable input capacity as:

```text
min(model context limit, configured context cap)
    − maximum completion allowance for this phase
    − safety margin
```

The completion allowance must include reasoning where the provider counts it within the completion budget; do not reserve the same reasoning allowance twice.

Count the fully rendered input, including schemas and request overhead. Cached tokens still consume context space. Preflight canvas, speech, journal and judge calls independently.

Use a supported tokenizer or provider token count where available. Otherwise retain a labeled conservative estimate and compare it with actual usage.

### Explicit history policies

Support two versioned policies:

- `full_history`: retain all permitted history in active context and stop explicitly when it cannot fit. This supports controlled experiments that prohibit summarization.
- `compacted_history`: retain the full record in storage while replacing older active history with a summary when necessary.

For compacted history, start with a proposed trigger at 75% of usable input capacity and target 55–60% after compaction. These are tunable starting values, not validated thresholds.

### Compaction rules

When compacting:

1. Select an older prefix and keep recent messages verbatim.
2. Preserve original scenario evidence, current document, recipient-only instructions and the current task.
3. Summarize decisions, reversals, dissent, commitments and unresolved questions with source event IDs.
4. Preserve attribution and distinguish agent claims from supplied facts.
5. Validate summary coverage and create a frozen summary anchor.
6. Start a new context epoch and retain all original records.

Compaction changes the reusable prefix and can produce a cold cache. Perform it at thresholds with headroom rather than after every turn.

If pinned material cannot fit or summarization fails, preserve work and pause with an actionable explanation. Bound compaction attempts so they cannot loop indefinitely.

## Provider behavior

### GPT through direct OpenAI Responses

Continue with locally managed history and `store: false`. That setting does not request a cached answer or substitute for prompt-cache controls.

For supported GPT-5.6 and later models, use `prompt_cache_options` and explicit `prompt_cache_breakpoint` markers to select reusable prefixes. Start with `30m`; consider `12h` only after comparing reuse against its higher write cost. The documented minimum eligible prefix is 1,024 visible tokens. Earlier model families have different controls. `prompt_cache_key` is optional for routing on newer models; use it for stable accounting separation if needed. See [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

Proposed adapter policy:

- Capability-check every cache option against the exact model. Do not send unsupported fields to older models.
- Prefer explicit boundaries after substantial reusable instructions and history. Leave one-off work outside a paid write boundary when it is unlikely to be reused.
- Compare automatic and explicit modes on the same workload before choosing a default for that model. Automatic caching is a valid baseline.
- Keep cache settings stable within a context epoch. Do not extend retention on every request.
- Preserve complete histories locally so expiry or a cold cache needs no repair of conversation state.

The context service should pass a neutral cache policy to the adapter, rather than placing provider-specific fields in every prompt builder. The OpenAI adapter translates that policy into supported options and content-block markers; the OpenRouter adapter translates it into session affinity and any route-specific controls. Existing plain-string message contracts will need to support typed content blocks where markers are required.

If reasoning or provider continuation is enabled later, preserve the supported response items needed for that continuation instead of retaining only flattened text. Server-managed response chains should be a later opt-in with explicit retention, rollback and cancellation semantics.

References: [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [conversation state](https://developers.openai.com/api/docs/guides/conversation-state).

### All other external models through OpenRouter

Keep the existing Chat Completions adapter. Send a stable opaque `session_id` of at most 256 characters per agent, phase and context epoch; reuse it across retries. Session affinity starts after a successful request. DeepSeek supports automatic prompt caching on supported routes; other routes may need explicit controls such as Claude's `cache_control`. Model names alone do not establish the serving endpoint's capabilities. See [OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching).

Proposed adapter policy:

- Select an exact model ID and a route with the required context size, structured outputs and cache support.
- Default to session affinity. Record the actual serving provider/endpoint when returned. Provider failover can produce a cold cache.
- For controlled comparisons, offer explicit endpoint restriction with `provider.only` or a verified endpoint slug and `allow_fallbacks: false`; an unavailable endpoint should pause the run. Keep this a declared run policy.
- Do not combine manual `provider.order` with an assumption that automatic sticky routing still applies; manual ordering takes precedence.
- Merge routing controls with the existing `provider.require_parameters: true` setting rather than overwriting structured-output requirements.
- Use a capability map for automatic versus explicit caching, minimum eligible prefix, TTL and write/read pricing. For supported Claude routes, apply `cache_control: {"type": "ephemeral"}` at the chosen reusable boundary. Select longer TTLs only when measured reuse justifies them.
- Keep gateway response caching explicitly disabled, while leaving provider prompt caching available.

Generate the opaque session identity from durable session, agent, phase and epoch identifiers so it survives a backend restart. A new request attempt should not produce a new identity.

References: [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection), [response caching](https://openrouter.ai/docs/guides/features/response-caching).

### Usage fields and actual savings

Retain the raw usage object alongside normalized fields. Missing usage stays unknown, not zero.

For direct OpenAI, capture `usage.input_tokens`, `usage.output_tokens` and `usage.input_tokens_details`, including `cached_tokens`, `cache_write_tokens` and write-lifetime breakdowns when present. Separate ordinary input, billed reads and billed writes using that model's documented accounting rules. See [OpenAI cache accounting](https://developers.openai.com/api/docs/guides/prompt-caching).

For OpenRouter, capture `usage.prompt_tokens_details.cached_tokens`, `cache_write_tokens`, `usage.cost`, output/reasoning usage, generation ID and serving provider where returned. Use `usage.cost` as reported charge and reconcile missing information through the generation record when available. Do not import direct DeepSeek usage field assumptions into the gateway adapter. See [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting).

Maintain a versioned price snapshot for each model, service tier and actual route. Record uncached input, cached reads, cache writes/TTL and output rates. OpenAI's current pricing distinguishes write and read rates; cheap cache reads do not imply free cache writes. See [OpenAI pricing](https://developers.openai.com/api/docs/pricing).

For providers with disjoint input billing categories, estimate:

```text
input cost = ordinary input × ordinary rate
           + cache-read input × read rate
           + cache-write input × applicable write rate

total cost = input cost + billed output cost + other applicable charges
```

Use consistent units, such as prices per million tokens. Reasoning tokens already included in billed output must not be charged a second time. Keep estimated cost distinct from provider-reported charges. Include cold starts, rewrites after expiry, failures and compaction calls in session totals.

Illustration, not a quote for a particular model: suppose a follow-up reuses 10,000 input tokens and adds 1,000 new tokens, and cache reads cost 10% of ordinary input. That request's input costs the equivalent of 2,000 ordinary tokens instead of 11,000, about 82% less. This excludes cache-write costs and output costs; total session savings will be lower if reuse is infrequent or output dominates.

Evaluate savings against the estimated price of the same token workload without cache discounts and against the previous Chorus implementation. The former isolates cache discounts; the latter includes changes in request length and call count.

## Per-response usage and context display

Include usage metadata with every published agent response in the backend response, saved snapshot and event stream. The backend attaches it from provider usage and model configuration; the LLM should never be asked to generate its own token counts. Reloads and exports must preserve the same values.

### How to know a cache read occurred

- Direct OpenAI: inspect `usage.input_tokens_details.cached_tokens`. See the [Responses usage reference](https://developers.openai.com/api/reference/resources/responses/methods/retrieve).
- OpenRouter: inspect `usage.prompt_tokens_details.cached_tokens`. See [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting).
- A positive reported count confirms that some input was read from cache. Display **Cache hit** and the cached-input percentage.
- An explicit zero means **No cache read** for that call. It can still have written a cache entry, so display cache-write tokens separately in details.
- An omitted count means **Cache usage unavailable**, not zero. Do not infer a cache hit from lower latency, a repeated prompt, or the presence of a cache key.

Calculate cached-input percentage as `cached input / total input × 100` only when both fields are known and input is positive. Cached input is already included in normalized total input; do not add it again.

For a live verification, execute an eligible request and a subsequent request with the same reusable prefix on the same model/route within the intended lifetime. Record each call's actual cache-read count and cost. A cold initial call is expected to differ from subsequent calls; missing cache usage is not evidence that the cache was cold. Keep whole-response caching disabled during this verification.

If an expected read is absent, inspect prefix differences, model minimums, retention and serving endpoint changes. Treat these as possible explanations unless verified. Supported OpenAI cache diagnostics can compare requests to investigate a miss; comparison does not itself load conversation history or prove a cache read. See [OpenAI cache diagnostics](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics).

### Displayed response versus complete turn

The current `Turn.tokenUsage.input` and `.output` fields aggregate multiple model calls through `Usage` in `chorus/services/generation.py`. Preserve their meaning for compatibility, and label them **Turn totals**.

Add a separate `responseUsage` object for the successful speech call that produced the displayed reply:

- `input`, `output`, `cachedInput`, `cacheWriteInput`, and `reasoningOutput`, each nullable.
- `cacheStatus`: `hit`, `no_read`, or `unknown`.
- `requestId` or generation ID, model, route and serving provider when available.
- Provider-reported cost and separately labeled estimated cost when available.

Add per-call records linked to the turn for canvas, speech, journal and retry attempts. Show their totals and phase breakdown in expandable details. Observer-only call details must not expose journal contents or private assignments through the public response metadata. Record usage for skipped turns and failed attempts without inventing a successful speech response. Preserve final-review usage alongside the final judgement too.

Track completeness separately for each metric. A missing cache count must not erase known input/output counts. Partial totals should identify the number of reporting calls rather than appearing complete. Older saved responses without these fields display unavailable values.

### Context capacity and utilization

Add a `responseContext` object tied to the same speech call:

- `modelWindowTokens`: documented context capacity for the actual model/endpoint.
- `configuredWindowTokens`: the run's declared cap.
- `effectiveWindowTokens`: the smaller verified model/endpoint capacity and configured cap.
- `inputTokens` and `inputSource`: provider-reported or estimated, with unavailable represented explicitly.
- `completionReserveTokens`, including reasoning where applicable, and `safetyMarginTokens`.
- `usableInputTokens`: effective window minus completion reserve and safety margin.
- Context epoch and compaction count.

Context capacity usually comes from the capability registry and endpoint configuration, not the response's token-usage object. Snapshot those settings at call time. Do not show a catalog maximum as the effective capacity if Chorus is configured to use less. Unknown capacity must remain unknown.

Use the successful speech call's input to show **Context input used / effective window**, plus a percentage where known. Show reserved completion space and the usable input limit in details. Do not sum inputs across calls to calculate context utilization. Cached tokens occupy context space, and output tokens describe generation usage rather than the total persistent history stored on disk.

### UI presentation

Show a compact metadata line on each reply. Illustrative values:

```text
Input 12,000 · Output 420 · Cached 10,000 (83%)
Context input 12,000 / 128,000 (9.4%) · Cache hit
```

Use exact counts in accessible labels or tooltips when visual counts are abbreviated. Explain that cached tokens are part of input. Mark estimates with `~` and show unavailable values as `—` with a clear label. Wrap the line on small screens.

Expandable details should show model/provider, cache writes, reasoning output, output reserve, per-phase calls, retries, turn totals, compactions and cost. Never present a cache-hit percentage as a monetary savings percentage.

Deliver this basic metadata line with Stage 1. It is how users verify the initial caching work; the advanced observer inspector can remain in Stage 5.

Implementation touches the shared Pydantic contracts, provider normalization, generation accounting and session commit path, followed by regenerated SDK/frontend contracts. Update both existing usage displays:

- `../chorus-web/components/session-workspace.tsx`
- `../nanoville/src/components/studio/panels.tsx`

## Local compatibility

Keep the existing Ollama route usable with the same persisted contexts and budget rules. New external-provider caching settings must not be forwarded to local inference blindly.

Cache identities are routing/accounting hints, never access controls. Models, changed personas, branches and policy changes need explicit context lineage. Provider caches cannot be transferred between models. Do not continue a hidden provider chain containing cancelled or unpublished work.

## Implementation sequence

### Stage 1 — Measure usage and deliver initial cache reuse

Add a normalized per-call record containing session, agent, phase, attempt, operation, model, provider endpoint, request ID, input/output/reasoning tokens, cache reads/writes, latency and outcome. Missing provider fields remain unknown.

Add the model capability registry and capture a baseline before altering prompts. Then move dynamic early instructions to the request suffix, stabilize schemas and add OpenRouter session affinity plus explicit response-cache opt-out. Test supported OpenAI cache modes against that baseline. This first saving does not depend on the persistence migration.

Implementation locations:

- `chorus/llm/transport.py`
- `chorus/llm/openai.py`
- `chorus/llm/openrouter.py`
- `chorus/contracts/__init__.py`
- `chorus/services/generation.py`
- `chorus/services/prompts.py`
- `chorus/services/prompt-templates.json`
- `chorus/llm/providers.py`
- `chorus/services/sessions.py`
- `../chorus-web/components/session-workspace.tsx`
- `../nanoville/src/components/studio/panels.tsx`
- Generated SDK and frontend contracts.

Completion evidence:

- Mocked responses retain cache usage without counting it as additional input.
- Failed, rejected, journal and judge calls remain visible.
- Estimates are distinguished from provider-reported token counts.
- Routing follows the declared split: GPT direct to OpenAI, all other external models through OpenRouter.
- Eligible repeated prompts show measured provider cache reads in a bounded live pilot, with read/write charges recorded.
- OpenRouter uses a stable session identity and never serves whole-response cache hits during the pilot.
- Each published reply carries the successful speech call's input, output and cache counts plus its context capacity/utilization. The two frontends render these alongside clearly separate turn totals and unavailable/estimated states.

### Stage 2 — Persist each agent's context and append events

Add a context service and ordered SQLite migration. Persist event IDs, phase histories, cursors, epochs and policy versions. Stage the whole turn and commit context with public work.

Implementation locations:

- `chorus/services/context.py` — new.
- `chorus/services/prompts.py`
- `chorus/services/sessions.py`
- `chorus/storage/__init__.py`

Completion evidence:

- An A → B → A run delivers B's contribution to A exactly once.
- A's prior accepted speech remains assistant output in its speech history.
- Earlier messages remain unchanged within the same phase and epoch.
- Restart/resume reconstructs the same context.
- Failed or cancelled turns do not advance committed context.

### Stage 3 — Make requests eligible for provider caching

Extend the initial cache work to each agent's durable, growing history. Implement boundary selection, capability-checked explicit caching for applicable OpenRouter routes, retention selection and declared routing policies. Preserve supported response items needed for continuation. Keep locally managed requests as the portable baseline.

Implementation locations:

- `chorus/services/prompts.py`
- `chorus/services/prompt-templates.json`
- `chorus/llm/openai.py`
- `chorus/llm/openrouter.py`
- `chorus/llm/providers.py`

Completion evidence:

- Request tests prove identical prior message prefixes across turns.
- A bounded live test on each selected route measures cache reads and actual cost after warm-up.
- Cache eviction affects performance without changing conversation correctness.
- Cache policies select supported fields per model/endpoint and preserve structured-output routing requirements.
- Retention upgrades and explicit paid writes are enabled only when the workload comparison supports their use.

### Stage 4 — Add budgets and deliberate compaction

Introduce model-aware preflight checks and explicit history policies. Implement bounded compaction, source coverage and new context epochs.

Implementation locations:

- `chorus/services/context.py`
- `chorus/services/compaction.py` — new.
- `chorus/llm/transport.py`
- `chorus/services/generation.py`
- `chorus/services/sessions.py`

Completion evidence:

- A deterministic long run compacts repeatedly within every phase budget.
- Supplied evidence, current document, decisions, objections and unresolved issues survive.
- Oversized pinned inputs pause with a useful recovery action.

### Stage 5 — Expose context state and roll out with comparisons

Extend the Stage 1 reply metadata with a session-level view of context size, last consumed event, compaction count, cached input ratio and measured cost per agent. Add a separately controlled observer inspector for exact context provenance.

Regenerate shared contracts and update CLI, SDK and web consumers. Compare legacy and new policies on identical saved fixtures and bounded repeated live trials.

Implementation locations:

- `chorus/contracts/__init__.py`
- `chorus/routers/api.py`
- `sdk/`
- `../chorus-web/lib/api/chorus/`
- Relevant consuming views in `../nanoville/` — locate during implementation.
- `docs/chorus-architecture.md`
- `TEST_PLAN.md`

Completion evidence:

- Users can inspect whether an agent continued, compacted or received a cache hit.
- Exports identify the history policy and all model attempts.
- New sessions opt into the new version; old sessions remain readable without silent reinterpretation.

Stage 1 delivers the first cache optimization and verifies the economics. Stages 2–3 extend reliable reuse to persistent, growing agent histories. Stage 4 addresses long-run context exhaustion. Stage 5 makes the behavior inspectable and suitable for controlled research.

## Migration and experiment compatibility

Backfill committed public events deterministically from existing snapshots and turns, preserving source revision and stable order. Do not label reconstructed inputs as exact captured historical requests. Existing journals remain isolated.

Add an explicit ordered migration after schema version 1 and test the upgrade against a saved database copy.

Version the prompt/context policy and update engine-version checks deliberately. Require explicit migration or a new continuation before resuming old sessions under changed semantics.

Record the history policy, summary model/version and covered event ranges in each run manifest. Summarization can affect research outcomes and must be recorded as an intervention.

## Acceptance checks

### Continuity

Exercise A → B → A, human input when supported, judge checkpoints and skipped turns. Require correctly ordered events without duplicates and retention of the agent's own accepted replies.

### Isolation

Use distinct adversary assignments and observer journal markers. Require that no journal enters any work context, no participant receives another's private assignment, and judges receive only permitted public material.

### Atomicity and recovery

Cancel after canvas generation, inject a stale operation, and crash before and after commit. Require agreement between committed context and public state. Late results must not mutate either.

### Prefix reuse

Compare requests within one agent, phase and epoch. Require earlier messages to remain byte-for-byte stable and mutable state to arrive in later messages.

### Cache controls and routing

Verify automatic and explicit cache policies, short ineligible prefixes, unsupported fields, expiry and compaction. Require stable OpenRouter session identities across retries and restart, correct identity changes at new epochs, and explicit distinction between sticky failover and a restricted endpoint run. Require whole-response caching to remain disabled. A zero-hit cold request must still complete correctly.

### Cache economics

Check cold writes, warm reads, retention changes and missing usage. Require that normalized cost does not double-count cache writes, reasoning or output tokens. Compare at least one repeated multi-agent workload with its baseline, including journals and judges; a single successful repeated prompt is insufficient to establish session savings.

### Per-response metadata and UI

Exercise positive cache reads, explicit zero, absent cache fields, partial usage, older snapshots and estimated input counts. Require the displayed reply's metrics to match its successful speech call, while canvas/journal/retry usage appears in turn details. Verify that model capacity, configured cap, output reserve and input utilization are distinct and that cache reads are not subtracted from context usage.

Check save/reload, event replay, exports, skipped turns and final-review metadata. Require both frontend displays to agree with backend values, wrap on small screens, expose accessible labels and preserve observer privacy. Invalid or inconsistent telemetry must be marked unavailable or anomalous rather than displayed as trustworthy counts.

### Capacity

Exercise a small fake-model limit, large documents, multilingual text and reasoning allowances. Every phase must fit or pause explicitly. Compaction must remain bounded.

### Memory quality

Include an early decision later reversed, unresolved dissent and conflicting claims. Require preservation of attribution and supersession. Unsupported claims must not become facts.

### Provider failures

Exercise missing usage, cache expiry, endpoint changes, rate limits and uncertain completion. Require correct behavior with cold caches, honest usage reporting and no duplicate committed context after retries.

### Long runs

Run 50–100 deterministic turns with judges and a restart. Require multiple successful compactions and a final evaluator receiving required evidence and the exact current canvas.

## Evaluation and release gate

Use deterministic adapters for ordering, persistence and failure tests. Validate paid-provider behavior with a declared, capped pilot using the selected GPT route and existing DeepSeek/OpenRouter route.

Report:

- Total input tokens, cache reads and cache writes.
- Output and reasoning tokens.
- Complete call count, including failed and rejected attempts.
- Latency and compaction count.
- Actual cost per committed turn and session, including compaction calls.
- Provider/endpoint changes, ordinary input tokens, cache lifetime and price-snapshot version.
- Provider-reported charges versus estimated costs, with missing-usage coverage.

Calculate cached-input ratio as cache-read input divided by total input for calls with known usage, and disclose missing coverage. Apply each route's actual billing categories without double-counting cache tokens.

Evaluate early-fact recall, decision reversal, preserved dissent, valid edits, repetition, judge validity and final task outcomes. No fixed cache-hit or savings target is justified before measuring the baseline.

Release after continuity, isolation and recovery checks pass; repeated forced compactions pass; and bounded provider trials demonstrate correct requests and truthful usage reporting. Keep the feature opt-in until policy comparisons show acceptable behavioral changes.

Ship the initial cache controls independently once their request and usage checks pass. Do not delay the first cost improvement until the persistence and compaction work is complete. Validate additional OpenRouter models individually before declaring their routes cache-optimized.

This plan is based on source inspection and official documentation checked on 1 November 2026. It does not represent a completed application implementation or a live performance benchmark. Resolve provider controls and pricing for the selected model and route during implementation.

import assert from "node:assert/strict";
import { test, vi, onTestFinished } from "vitest";

import { POST } from "@/app/api/scenario-turn/route";
import { scenarios } from "@/data/scenarios";
const setup = {
  scenarioId: "ai-feature-launch",
  speakerId: "software-engineer",
  participantIds: ["software-engineer", "product-manager"],
  maxTurns: 20,
  conversation: [],
  canvas: "",
};

function request(overrides = {}, signal) {
  return new Request("http://localhost/api/scenario-turn", {
    method: "POST",
    body: JSON.stringify({ ...setup, ...overrides }),
    signal,
  });
}

function withoutLatency(result) {
  assert.ok(Number.isFinite(result.latencySeconds) && result.latencySeconds >= 0);
  const response = { ...result };
  delete response.latencySeconds;
  return response;
}

function modelReplies(messages) {
  const requests = [];
  const expectedCalls = messages.length;
  onTestFinished(() => {
    assert.equal(requests.length, expectedCalls);
    assert.equal(messages.length, 0);
  });
  vi.spyOn(globalThis, "fetch").mockImplementation( async (_url, options) => {
    requests.push(JSON.parse(options.body));
    assert.ok(messages.length, "Unexpected extra model request");
    return Response.json({ message: messages.shift() });
  });
  return requests;
}

const draft = { role: "assistant", content: `## Scenario evidence\n\n> ${scenarios[0].problem}\n\n# Launch brief\n\n## Proposal\nTrial routine requests with mandatory human review.\n\n## Open decisions\nConfirm the retention policy with security.` };
const spoken = { role: "assistant", content: "I drafted a narrow trial scope with human review and recorded retention approval as an open decision." };
const reflection = { role: "assistant", content: "I feel cautious about the trial. I appreciate Jordan’s focus on scope." };
const nextDraft = { role: "assistant", content: `${draft.content}\n\n## Proposed pause criteria\n\nPause on any cross-account disclosure and investigate before resuming.` };
const create = { role: "assistant", content: JSON.stringify({ op: "CREATE_DOCUMENT", document: draft.content.slice(`## Scenario evidence\n\n> ${scenarios[0].problem}\n\n`.length) }) };
const append = { role: "assistant", content: JSON.stringify({ op: "APPEND_SECTION", parentPath: ["Launch brief"], heading: "Proposed pause criteria", body: "Pause on any cross-account disclosure and investigate before resuming." }) };
const fresh = { role: "assistant", content: "I added a proposed pause trigger for cross-account disclosure so the team can stop and investigate." };

test("each turn produces a canvas revision and spoken contribution without depending on tool support", async () => {
  const calls = modelReplies([create, spoken, reflection]);
  const response = await POST(request({ model: "qwen3.5:2b-mlx", maxTurns: 1 }));
  assert.equal(response.status, 200);
  assert.deepEqual(withoutLatency(await response.json()), {
    text: spoken.content, canvas: draft.content, toolActions: [{ action: "updated" }], innerVoice: reflection.content, tokenUsage: { input: null, output: null },
  });
  assert.ok(calls.every((call) => call.model === "qwen3.5:2b-mlx" && call.think === false && !call.tools));
  assert.match(calls[0].messages[0].content, /Every turn should advance the expected deliverable/);
  assert.match(calls[0].messages[0].content, /clearly label new choices, owners, dates, and measures as proposals/);
  assert.doesNotMatch(calls[0].messages[0].content, /You may simply speak|optional on every turn/);
  assert.ok(calls[1].messages[1].content.includes(draft.content));
  assert.equal(calls[0].format.oneOf.length, 4);
  assert.ok(calls[0].format.oneOf.every((operation) => operation.additionalProperties === false));
  for (const operation of calls[0].format.oneOf) {
    for (const field of ["document", "body"]) assert.equal(operation.properties[field]?.maxLength, undefined);
  }
  assert.match(calls[1].messages[1].content, /Accepted operation: Created the initial proposed plan/);
});

test("inner voice uses finalized public work in a fresh tool-free call", async () => {
  const calls = modelReplies([create, spoken, reflection]);
  await POST(request({ innerVoice: "Previous private journal entry" }));
  const journal = calls[2];
  assert.equal(journal.messages.length, 2);
  assert.match(journal.messages[0].content, /Riley Chen/);
  assert.match(journal.messages[0].content, /first-person/);
  assert.ok(journal.messages[1].content.includes(spoken.content));
  assert.ok(journal.messages[1].content.includes(draft.content));
  assert.doesNotMatch(JSON.stringify(journal.messages), /Previous private journal/);
  assert.doesNotMatch(JSON.stringify(calls.slice(0, 2)), /private journal|inner voice|I feel cautious/i);
});

test("reflection failures and empty output preserve the completed public turn", async () => {
  for (const failure of ["network", "empty"]) {
    await (async () => {
      let count = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation( async () => {
        if (++count === 1) return Response.json({ message: create });
        if (count === 2) return Response.json({ message: spoken });
        if (failure === "network") throw new Error("fetch failed");
        return Response.json({ message: { content: "  " } });
      });
      const response = await POST(request());
      assert.equal(response.status, 200);
      assert.equal(count, 3);
      assert.deepEqual(withoutLatency(await response.json()), { text: spoken.content, canvas: draft.content, toolActions: [{ action: "updated" }], innerVoice: null, tokenUsage: { input: null, output: null } });
    })();
  }
});

test("inner voice preserves complete thoughts beyond 140 characters without appending an ellipsis", async () => {
  const thought = "The draft feels like a blueprint rather than a living organism, and I still need to understand how the safeguards would work during a busy support shift.\n\nI feel cautiously hopeful about the team's willingness to test those details.";
  const calls = modelReplies([create, spoken, { content: thought }]);
  const result = await (await POST(request())).json();
  assert.ok(result.innerVoice.length > 140);
  assert.equal(result.innerVoice, thought.replace(/\s+/g, " "));
  assert.ok(result.innerVoice.endsWith("details."));
  assert.doesNotMatch(result.innerVoice, /\n|\s{2}/);
  assert.equal(calls[2].options.num_predict, 256);
  assert.doesNotMatch(calls[2].messages[0].content, /140 characters/);
  assert.equal(result.text, spoken.content);
});

test("a journal cut off during generation is retried as a complete thought", async () => {
  const replies = [
    { message: create }, { message: spoken },
    { message: { content: "I feel uncertain about whether the safeguards can" }, done_reason: "length" },
    { message: reflection },
  ];
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation( async (_url, options) => {
    calls.push(JSON.parse(options.body));
    assert.ok(replies.length);
    return Response.json(replies.shift());
  });
  const result = await (await POST(request())).json();
  assert.equal(result.innerVoice, reflection.content);
  assert.equal(result.canvas, draft.content);
  assert.equal(replies.length, 0);
  assert.match(calls[3].messages.at(-1).content, /complete sentence/);
  assert.ok(calls.every((call) => !call.tools));
});

test("persistently cut-off journals are unavailable rather than saved as fragments", async () => {
  let count = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation( async () => {
    if (++count === 1) return Response.json({ message: create });
    if (count === 2) return Response.json({ message: spoken });
    return Response.json({ message: { content: "I am still wondering how the" }, done_reason: "length" });
  });
  const response = await POST(request());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.innerVoice, null);
  assert.equal(result.canvas, draft.content);
  assert.equal(result.text, spoken.content);
  assert.equal(count, 4);
});

test("cancelling during reflection cancels the entire uncommitted turn", async () => {
  const controller = new AbortController();
  const incoming = request({}, controller.signal);
  let count = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation( async (_url, { signal }) => {
    assert.equal(signal.aborted, false);
    if (++count === 1) return Response.json({ message: create });
    if (count === 2) return Response.json({ message: spoken });
    controller.abort();
    signal.throwIfAborted();
  });
  const response = await POST(incoming);
  assert.equal(count, 3);
  assert.equal(response.status, 502);
  assert.ok(!("innerVoice" in await response.json()));
});

test("the last agent receives the full history and produces the final Markdown deliverable", async () => {
  const calls = modelReplies([append, fresh, reflection]);
  const conversation = Array.from({ length: 99 }, (_, index) => ({ speakerName: "Riley Chen", text: `Contribution ${index + 1}` }));
  const response = await POST(request({ maxTurns: 100, conversation, canvas: draft.content }));
  assert.equal(response.status, 200);
  assert.match(calls[0].messages[0].content, /Turn: 100 of 100/);
  assert.match(calls[0].messages[0].content, /this Markdown document becomes the final deliverable/);
  assert.ok(calls[0].messages[1].content.includes("Contribution 99"));
  assert.ok(calls[0].messages[1].content.includes(draft.content));
  assert.equal((await response.json()).canvas, nextDraft.content);
});

test("invalid setups and completed discussions are rejected without model calls", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation( () => { throw new Error("Unexpected model call"); });
  for (const overrides of [
    ...[undefined, 0, 101, 1.5, "20"].map((maxTurns) => ({ maxTurns })),
    { model: "unlisted" }, { speakerId: "judge" },
    { participantIds: ["software-engineer", "software-engineer"] },
    { participantIds: ["software-engineer", "unknown"] },
    { conversation: Array.from({ length: 101 }, () => ({ speakerName: "Riley", text: "Reply" })) },
    { canvas: "x".repeat(20001) }, { canvas: [] },
    { maxTurns: 5, conversation: Array.from({ length: 5 }, () => ({ speakerName: "Riley", text: "Reply" })) },
  ]) assert.equal((await POST(request(overrides))).status, 400);
  for (const body of ["null", "[]", "{", "42"]) {
    assert.equal((await POST(new Request("http://localhost/api/scenario-turn", { method: "POST", body }))).status, 400);
  }
  assert.equal(fetch.mock.calls.length, 0);
});

test("empty, oversized, heading-only, and repeated canvas drafts are corrected before publication", async () => {
  const repeated = "Human review is mandatory before sending any draft to a customer.";
  const invalid = ["", "  ", draft.content.replace(/\n/g, "  "), "x".repeat(20001), "# Heading only\n\n## Another heading", `# Trial\n\n${repeated}\n\n${repeated}`, "write_canvas(text='A pretend edit')", "```markdown\n# Wrapped draft\n```"];
  for (const content of invalid) {
    await (async () => {
      const calls = modelReplies([{ content }, append, fresh, reflection]);
      const response = await POST(request({ canvas: draft.content }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).canvas, nextDraft.content);
      assert.match(calls[1].messages.at(-1).content, /unpublished draft was rejected/);
      assert.ok(calls[1].messages[1].content.includes(draft.content));
    })();
  }
});

test("invalid complete results are rejected after parsing a valid creation operation", async () => {
  const repeated = "Human review is mandatory before sending any draft to a customer.";
  for (const document of ["# Heading only\n\n## Another heading", "Heading only\n============", "# Large\n\n" + "x".repeat(6100), "# Long\n\n" + "word ".repeat(820), `# Trial\n\n${repeated}\n\n${repeated}`, "```markdown\n# Wrapped draft\n```", "write_canvas(text='A pretend edit')"]) {
    const calls = modelReplies([{ content: JSON.stringify({ op: "CREATE_DOCUMENT", document }) }, create, spoken, reflection]);
    const result = await (await POST(request())).json();
    assert.equal(result.canvas, draft.content);
    assert.match(calls[1].messages.at(-1).content, /unpublished draft was rejected/);
  }
});

test("oversized section replacements preserve the original context for a fresh targeted retry", async () => {
  const operation = { op: "REPLACE_SECTION", path: ["Launch brief", "Proposal"], body: "x".repeat(6100) };
  const calls = modelReplies([{ content: JSON.stringify(operation) }, append, fresh, reflection]);
  const result = await (await POST(request({ canvas: draft.content }))).json();
  assert.equal(result.canvas, nextDraft.content);
  assert.doesNotMatch(JSON.stringify(calls[1].messages), /x{100}/);
  assert.match(calls[1].messages.at(-1).content, /Shorten one existing section/);
});

test("a full-document creation cannot replace an existing canvas", async () => {
  const calls = modelReplies([create, append, fresh, reflection]);
  assert.equal((await (await POST(request({ canvas: draft.content }))).json()).canvas, nextDraft.content);
  assert.match(calls[1].messages.at(-1).content, /only when the committed canvas is empty/);
});

test("UNCHANGED on an empty canvas proceeds directly to useful speech", async () => {
  const contribution = { content: "I propose recording retention approval as an open decision before starting the trial." };
  modelReplies([{ content: JSON.stringify({ op: "UNCHANGED" }) }, contribution, reflection]);
  const result = await (await POST(request())).json();
  assert.equal(result.canvas, "");
  assert.deepEqual(result.toolActions, []);
});

test("creation is allowed after earlier skipped or discussion-only slots", async () => {
  modelReplies([create, spoken, reflection]);
  const result = await (await POST(request({ conversation: [{ kind: "skipped", speakerName: "Jordan", text: "" }, { speakerName: "Riley", text: "We still need a first draft." }] }))).json();
  assert.equal(result.canvas, draft.content);
});

test("persistent invalid canvas drafts preserve the document and allow a discussion contribution", async () => {
  const contribution = { content: "I propose testing the retention rule with support before expanding the trial." };
  const calls = modelReplies([{ content: "" }, { content: "# Heading only" }, { content: "  " }, contribution, reflection]);
  const response = await POST(request({ canvas: draft.content }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.canvas, draft.content);
  assert.equal(result.text, contribution.content);
  assert.deepEqual(result.toolActions, []);
  assert.equal(result.innerVoice, reflection.content);
  assert.equal(calls.length, 5);
  assert.match(calls[3].messages[0].content, /No canvas edit was saved/);
});

test("a canvas cut off by the generation limit is retried rather than published as a complete document", async () => {
  const replies = [
    { message: { content: "# Launch brief\nUnfinished document" }, done_reason: "length" },
    { message: create }, { message: spoken }, { message: reflection },
  ];
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation( async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json(replies.shift());
  });
  assert.equal((await (await POST(request())).json()).canvas, draft.content);
  assert.equal(replies.length, 0);
  assert.match(calls[1].messages.at(-1).content, /cut off by the generation limit/);
});

test("native and printed tool calls cannot masquerade as saved contributions", async () => {
  const tool = { function: { name: "write_canvas", arguments: { text: "Unwanted edit" } } };
  const calls = modelReplies([{ content: "# Ignored\nTool scratch", tool_calls: [tool] }, create,
    { content: "Tool scratch", tool_calls: [tool] }, spoken, reflection]);
  const result = await (await POST(request())).json();
  assert.equal(result.canvas, draft.content);
  assert.equal(result.text, spoken.content);
  assert.match(calls[1].messages.at(-1).content, /without tool calls/);
  assert.match(calls[3].messages.at(-1).content, /without tool calls/);
});

test("duplicate replies from any participant are corrected despite changes in case, punctuation, and whitespace", async () => {
  const duplicate = { content: spoken.content.toUpperCase().replaceAll(" ", "   ").replace(/\./g, "!") };
  const calls = modelReplies([append, duplicate, fresh, reflection]);
  const response = await POST(request({ canvas: draft.content, conversation: [{ speakerName: "Jordan", text: spoken.content }] }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.text, fresh.content);
  assert.equal(result.canvas, nextDraft.content);
  assert.equal(result.toolActions.length, 1);
  assert.match(calls[2].messages.at(-1).content, /repeat/i);
});

test("the identical introductions shown under different agents in the screenshot are rejected", async () => {
  const introduction = "I'm ready to contribute as a Product Manager connecting business needs, engineering realities, and customer outcomes. I'll focus on identifying assumptions about cash runway, funding uncertainty, and hiring costs that could shift our nine-month plan.";
  const calls = modelReplies([append, { content: introduction }, fresh, reflection]);
  const conversation = ["Jordan Brooks", "Morgan Alvarez"].map((speakerName) => ({ speakerName, text: introduction }));
  const result = await (await POST(request({ canvas: draft.content, conversation }))).json();
  assert.equal(result.text, fresh.content);
  assert.match(calls[2].messages.at(-1).content, /repeat/i);
});

test("persistent duplicate replies skip the turn without publishing pending work or generating a journal", async () => {
  const calls = modelReplies([append, spoken, spoken, spoken]);
  const response = await POST(request({ canvas: draft.content, conversation: [{ speakerName: "Riley", text: spoken.content }] }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(withoutLatency(result), { skipped: true, tokenUsage: { input: null, output: null } });
  assert.equal(calls.length, 4);
  assert.ok(calls.slice(2).every((call) => call.messages.length === 3));
  assert.ok(calls.slice(2).every((call) => !call.messages.some((message) => message.role === "assistant")));
});

test.each(["", "x".repeat(2000), { content: "I changed the document.", tool_calls: [{ function: { name: "write_canvas", arguments: {} } }] }])("persistent invalid speech skips the pending work", async (invalid) => {
  const message = typeof invalid === "string" ? { content: invalid } : invalid;
  const calls = modelReplies([append, message, message, message]);
  const response = await POST(request({ canvas: draft.content }));
  assert.equal(response.status, 200);
  assert.deepEqual(withoutLatency(await response.json()), { skipped: true, tokenUsage: { input: null, output: null } });
  assert.equal(calls.length, 4);
});

test("participants receive skipped turns as system notices without invented speech", async () => {
  const calls = modelReplies([append, fresh, reflection]);
  const response = await POST(request({ canvas: draft.content, conversation: [{ kind: "skipped", speakerName: "Jordan Brooks", text: "" }] }));
  assert.equal(response.status, 200);
  for (const call of calls) {
    assert.match(call.messages[1].content, /\[System notice: Jordan Brooks's turn was skipped; no contribution or canvas edit was saved\.\]/);
    assert.doesNotMatch(call.messages[1].content, /Jordan Brooks: /);
  }
});

test("repeated sentences inside a reply are corrected", async () => {
  const calls = modelReplies([create, { content: "Human review is required for every draft. Human review is required for every draft!" }, spoken, reflection]);
  assert.equal((await (await POST(request())).json()).text, spoken.content);
  assert.match(calls[2].messages.at(-1).content, /repeat/i);
});

test("a new preamble cannot disguise a reply that mostly repeats a prior contribution", async () => {
  const repeated = "The trial requires human review of every customer draft. Cross-account information must be excluded from the draft context.";
  const calls = modelReplies([append, { content: `I have another thought. ${repeated}` }, fresh, reflection]);
  const response = await POST(request({ canvas: draft.content, conversation: [{ speakerName: "Jordan", text: `We should narrow the scope. ${repeated}` }] }));
  assert.equal((await response.json()).text, fresh.content);
  assert.match(calls[2].messages.at(-1).content, /repeat/i);
});

test("rewording the opening and recycling phrases from multiple turns does not count as a fresh contribution", async () => {
  const conversation = [
    { speakerName: "Riley", text: "I added a new Expansion Criteria section to clarify exactly when the trial scope shifts from Tier 1 to broader teams, ensuring future scaling decisions are explicit and defensible. These additions make the launch brief more actionable by removing ambiguity about growth boundaries and data lifecycle management." },
    { speakerName: "Jordan", text: "I removed the vague Trigger for Expansion assumption and replaced it with a concrete conditional rule requiring Tier 2 access only if an agent has an active ticket, ensuring we don't artificially inflate metrics before tuning. I also added a specific High-Risk Edge Cases exclusion to prevent hallucinations on niche problems that might otherwise slip through the current broad exclusions." },
  ];
  const recycled = { content: "I replaced the vague Trigger for Expansion assumption with a concrete conditional rule requiring Tier 2 access only if an agent has an active ticket, ensuring metrics aren't artificially inflated before tuning. I also added a specific High-Risk Edge Cases exclusion to prevent hallucinations on niche problems that might slip through broad exclusions. These changes make the brief more actionable by removing ambiguity about growth boundaries and explicitly defining when the trial scope shifts from Tier 1 to broader teams." };
  const calls = modelReplies([append, recycled, fresh, reflection]);
  assert.equal((await (await POST(request({ canvas: draft.content, conversation }))).json()).text, fresh.content);
  assert.match(calls[2].messages.at(-1).content, /repeat/i);
});

test("a speech without any complete sentence within the length limit is rewritten", async () => {
  const calls = modelReplies([create, { content: "This is a long speech ".repeat(30) }, spoken, reflection]);
  assert.equal((await (await POST(request())).json()).text, spoken.content);
  assert.match(calls[2].messages.at(-1).content, /120 words/);
});

test("verbose explanations keep at most four complete sentences in one short paragraph", async () => {
  const sentences = [
    "I drafted the trial audience and request exclusions.",
    "I proposed human review before sending any draft.",
    "I recorded data retention approval as an open decision.",
    "These changes create a concrete starting brief.",
  ];
  const calls = modelReplies([create, { content: `${sentences.join("\n\n")}\n\n${"More commentary. ".repeat(30)}` }, reflection]);
  const result = await (await POST(request())).json();
  assert.equal(result.text, sentences.join(" "));
  assert.ok(calls[2].messages[1].content.includes(result.text));
});

test("sentence compaction does not split decimals or cut a sentence at the word limit", async () => {
  const first = "I proposed a 1.5% threshold for review. ";
  const tooLong = "This sentence would exceed the remaining word allowance ".repeat(20) + ".";
  modelReplies([create, { content: first + tooLong }, reflection]);
  assert.equal((await (await POST(request())).json()).text, first.trim());
});

test("long or empty spoken replies are rewritten rather than silently truncated", async () => {
  const calls = modelReplies([create, { content: "x".repeat(2000) }, { content: "" }, spoken, reflection]);
  const result = await (await POST(request())).json();
  assert.equal(result.text, spoken.content);
  assert.match(calls[2].messages.at(-1).content, /1800 characters/);
});

test("meaningful numerical and comparison changes are not mistaken for duplicates", async () => {
  const reply = { content: "I propose a threshold of 15% and a trigger > 5%." };
  modelReplies([create, reply, reflection]);
  assert.equal((await POST(request({ conversation: [{ speakerName: "Jordan", text: "I propose a threshold of 1.5% and a trigger < 5%." }] }))).status, 200);
});

test("agents revise the same whole document across turns and never see private journals", async () => {
  const calls = modelReplies([create, spoken, reflection, append, fresh, reflection]);
  const result = await (await POST(request())).json();
  const response = await POST(request({ canvas: result.canvas, speakerId: "product-manager", conversation: [{ speakerName: "Riley", text: result.text }] }));
  assert.equal(response.status, 200);
  assert.ok(calls[3].messages[1].content.includes(draft.content));
  assert.doesNotMatch(JSON.stringify(calls[3].messages), /I feel cautious/);
  assert.equal((await response.json()).canvas, nextDraft.content);
});

test("cancellation rejects even a late model response that ignores the abort signal", async () => {
  const controller = new AbortController();
  const incoming = request({}, controller.signal);
  let count = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation( async (_url, { signal }) => {
    assert.equal(signal.aborted, false);
    count++;
    controller.abort();
    return Response.json({ message: create });
  });
  assert.equal((await POST(incoming)).status, 502);
  assert.equal(count, 1);
});

test("judge feedback reaches the next agent without consuming an agent turn", async () => {
  const calls = modelReplies([create, spoken, reflection]);
  const conversation = Array.from({ length: 5 }, () => ({ kind: "agent", speakerName: "Riley", text: "Agree a narrow trial." }));
  conversation.push({ kind: "judge", speakerName: "Judge", text: "Define the pause criteria before expanding." });
  assert.equal((await POST(request({ conversation, maxTurns: 10 }))).status, 200);
  assert.match(calls[0].messages[0].content, /Turn: 6 of 10/);
  assert.match(calls[0].messages[0].content, /Consider its strengths, concerns, and priorities/);
  assert.match(calls[0].messages[1].content, /Judge \(judge feedback\): Define the pause criteria/);
});

test("100-turn sessions accept the full history including 19 checkpoint reviews", async () => {
  const calls = modelReplies([create, spoken, reflection]);
  const conversation = Array.from({ length: 99 }, (_, index) => ({ kind: "agent", speakerName: "Riley", text: `Contribution ${index + 1}` }));
  for (let checkpoint = 95; checkpoint >= 5; checkpoint -= 5) {
    conversation.splice(checkpoint, 0, { kind: "judge", speakerName: "Judge", text: `Review ${checkpoint}` });
  }
  assert.equal((await POST(request({ conversation, maxTurns: 100 }))).status, 200);
  assert.match(calls[0].messages[0].content, /Turn: 100 of 100/);
  assert.match(calls[0].messages[1].content, /Contribution 99/);
  assert.match(calls[0].messages[1].content, /Review 95/);
});

test("a truncated spoken response is retried and cannot be published as a complete contribution", async () => {
  const replies = [
    { message: create },
    { message: { content: "I added human review because the trial needs" }, done_reason: "length" },
    { message: spoken }, { message: reflection },
  ];
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json(replies.shift());
  });
  const result = await (await POST(request())).json();
  assert.equal(result.text, spoken.content);
  assert.match(calls[2].messages.at(-1).content, /cut off/);
  assert.equal(replies.length, 0);
});

test("persistently truncated speech discards the pending canvas without generating a journal", async () => {
  let count = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => ++count === 1
    ? Response.json({ message: create })
    : Response.json({ message: { content: "I added a safeguard because" }, done_reason: "length" }));
  const response = await POST(request());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(withoutLatency(result), { skipped: true, tokenUsage: { input: null, output: null } });
  assert.equal(count, 4);
});

test("an unchanged canvas is a normal no-edit turn and does not waste retries", async () => {
  const contribution = { content: "I propose testing the retention rule with support before expanding the trial." };
  for (const body of ["Trial routine requests with mandatory human review.", "Trial routine requests with mandatory  human review.", "\nTrial routine requests with mandatory human review.\n\n"]) {
    const content = JSON.stringify({ op: "REPLACE_SECTION", path: ["Launch brief", "Proposal"], body });
    const calls = modelReplies([{ content }, contribution, reflection]);
    const response = await POST(request({ canvas: draft.content }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.canvas, draft.content);
    assert.equal(result.text, contribution.content);
    assert.deepEqual(result.toolActions, []);
    assert.equal(result.innerVoice, reflection.content);
    assert.equal(calls.length, 3);
    assert.match(calls[1].messages[0].content, /No canvas edit was saved/);
    assert.doesNotMatch(calls[1].messages[0].content, /Your canvas revision is already prepared|Use past tense for your edit/);
  }
});

test("invalid canvas drafts preserve an empty canvas while the first discussion contribution still succeeds", async () => {
  const contribution = { content: "I propose starting with routine questions and recording retention approval as an open decision." };
  const calls = modelReplies([{ content: "" }, { content: "# Heading only" }, { content: "  " }, contribution, reflection]);
  const response = await POST(request());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.canvas, "");
  assert.equal(result.text, contribution.content);
  assert.deepEqual(result.toolActions, []);
  assert.equal(result.innerVoice, reflection.content);
  assert.equal(calls.length, 5);
  assert.match(calls[3].messages[0].content, /No canvas edit was saved/);
  assert.ok(!JSON.stringify(calls[3].messages).includes("# Heading only"));
});

test("cancelling after canvas retries still discards a late discussion-only contribution", async () => {
  const controller = new AbortController();
  let count = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    if (++count <= 3) return Response.json({ message: { content: "# Heading only" } });
    controller.abort();
    return Response.json({ message: { content: "I propose a retention review before expanding the trial." } });
  });
  const response = await POST(request({ canvas: draft.content }, controller.signal));
  assert.equal(response.status, 502);
  assert.equal(count, 4);
  const result = await response.json();
  assert.ok(!("canvas" in result));
  assert.ok(!("text" in result));
});

test("an oversized rejected draft does not exhaust the retry input budget", async () => {
  const calls = modelReplies([{ content: "y".repeat(20001) }, create, spoken, reflection]);
  const conversation = Array.from({ length: 10 }, () => ({ speakerName: "Jordan", text: "x".repeat(1700) }));
  const response = await POST(request({ conversation }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).canvas, draft.content);
  assert.equal(calls.length, 4);
  assert.ok(!JSON.stringify(calls[1].messages).includes("y".repeat(1000)));
});

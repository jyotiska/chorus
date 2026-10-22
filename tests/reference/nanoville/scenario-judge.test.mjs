import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { POST } from "@/app/api/scenario-judge/route";
import { isFinalJudgement, isJudgeReview, reviewMessage } from "@/lib/judgement";
const setup = {
  scenarioId: "ai-feature-launch", model: "qwen3.5:2b-mlx",
  participantIds: ["software-engineer", "product-manager"], maxTurns: 20,
  conversation: Array.from({ length: 5 }, () => ({ kind: "agent", speakerName: "Riley", text: "Confirm a narrow trial." })),
  canvas: "# Trial\nHuman review required.", reviewType: "checkpoint",
};
const review = {
  summary: "The trial has a useful starting scope.", strengths: ['The canvas records [Human review].'],
  improvements: ["Pause criteria are still missing."], nextPriorities: ["Define when to pause."],
};
const final = {
  ...review, verdict: "Partially meets requirements", feedbackResponse: "No previous feedback was given.",
  requirements: ["Expected deliverable", ...Array.from({ length: 5 }, (_, index) => `Guideline ${index + 1}`)].map((criterion) => ({
    criterion, status: "Partially met", evidence: 'The canvas records [Human review]; measures remain open.',
  })),
};
function request(overrides = {}, signal) {
  return new Request("http://localhost/api/scenario-judge", { method: "POST", body: JSON.stringify({ ...setup, ...overrides }), signal });
}
function withoutLatency(result) {
  assert.ok(Number.isFinite(result.latencySeconds) && result.latencySeconds >= 0);
  const response = { ...result };
  delete response.latencySeconds;
  return response;
}
function reply(value) {
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation( async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json({ message: { content: typeof value === "string" ? value : JSON.stringify(value) } });
  });
  return calls;
}

test("checkpoint reviews use the selected model and full context without canvas tools", async () => {
  const calls = reply(review);
  const conversation = [...setup.conversation,
    { kind: "judge", speakerName: "Judge", text: "Earlier feedback: choose a narrow trial." },
    ...setup.conversation,
  ];
  const response = await POST(request({ conversation }));
  assert.equal(response.status, 200);
  assert.deepEqual(withoutLatency(await response.json()), { text: reviewMessage(review), tokenUsage: { input: null, output: null } });
  assert.equal(calls[0].model, setup.model);
  assert.equal(calls[0].tools, undefined);
  assert.equal(calls[0].format.type, "object");
  assert.match(calls[0].messages[1].content, /Completed agent turns: 10 of 20/);
  assert.ok(calls[0].messages[1].content.includes(setup.canvas));
  assert.match(calls[0].messages[1].content, /Earlier feedback/);
  assert.match(calls[0].messages[0].content, /cannot edit the canvas/);
});

test("judge checkpoints distinguish skipped slots from completed contributions", async () => {
  const calls = reply(review);
  const conversation = [...setup.conversation.slice(0, 3),
    { kind: "skipped", speakerName: "Jordan Brooks", text: "" },
    { kind: "skipped", speakerName: "Riley Chen", text: "" },
  ];
  assert.equal((await POST(request({ conversation }))).status, 200);
  assert.match(calls[0].messages[0].content, /Skipped turns are system notices, not participant contributions/);
  assert.match(calls[0].messages[1].content, /Completed agent turns: 3 of 20\nSkipped turns: 2\nTurns used: 5 of 20/);
  assert.match(calls[0].messages[1].content, /\[System notice: Jordan Brooks's turn was skipped/);
  assert.doesNotMatch(calls[0].messages[1].content, /Jordan Brooks: /);
});

test("turn-limit and early-stop reviews return structured final judgements", async () => {
  const calls = reply(final);
  for (const overrides of [
    { maxTurns: 5, endReason: "turn-limit" },
    { endReason: "stopped", conversation: [] },
  ]) {
    const response = await POST(request({ reviewType: "final", ...overrides }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { judgement: final });
  }
  assert.match(calls[0].messages[1].content, /Final review at the turn limit/);
  assert.match(calls[1].messages[1].content, /early stop/);
  assert.match(calls[1].messages[1].content, /No contributions yet/);
  assert.equal(calls[0].format.properties.requirements.required.length, 6);
});

test("invalid setups and reviews that are not due never call the model", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation( () => { throw new Error("Unexpected model call"); });
  for (const overrides of [
    { model: "unlisted" }, { participantIds: ["judge"] }, { participantIds: ["software-engineer", "software-engineer"] }, { maxTurns: 0 },
    { canvas: "x".repeat(20001) }, { conversation: [] }, { reviewType: "unknown" },
    { conversation: setup.conversation.slice(0, 4) }, { maxTurns: 5 },
    { conversation: [...setup.conversation, { kind: "judge", speakerName: "Judge", text: "Already reviewed." }] },
    { reviewType: "final", endReason: "turn-limit" }, { reviewType: "final", endReason: "unknown" },
  ]) {
    assert.equal((await POST(request(overrides))).status, 400, JSON.stringify(overrides));
  }
  assert.equal(fetch.mock.calls.length, 0);
});

test("malformed or incomplete reviews fail visibly rather than fabricating a judgement", async () => {
  for (const value of ["not JSON", {}, { ...review, strengths: ["x".repeat(141)] }]) {
    await (async () => {
      reply(value);
      assert.equal((await POST(request())).status, 502);
    })();
  }
  for (const value of [review, { ...final, requirements: [] }, { ...final, requirements: Array(6).fill(final.requirements[0]) }]) {
    await (async () => {
      reply(value);
      assert.equal((await POST(request({ reviewType: "final", endReason: "stopped" }))).status, 502);
    })();
  }
});

test("the largest valid checkpoint message fits the next agent’s input limit", () => {
  const review = {
    summary: "scope ".repeat(48) + "scope.", strengths: Array(3).fill("review ".repeat(19) + "review."),
    improvements: Array(3).fill("safety ".repeat(19) + "safety."), nextPriorities: Array(3).fill("checks ".repeat(19) + "checks."),
  };
  assert.ok(isJudgeReview(review));
  assert.ok(reviewMessage(review).length <= 1800);
});

test("an empty canvas cannot receive credit for a completed written deliverable", async () => {
  const calls = reply(final);
  const response = await POST(request({ reviewType: "final", endReason: "stopped", canvas: "   " }));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /evidence-based review/);
  assert.match(calls[0].messages[0].content, /a promise to produce something is not evidence that it exists/);
  assert.equal(calls.length, 2);
  assert.match(calls[1].messages.at(-1).content, /actual shared canvas is EMPTY/);
});

test("an empty canvas can be reviewed honestly as missing work", async () => {
  const judgement = {
    ...final, verdict: "Needs more work",
    requirements: final.requirements.map((item) => ({ ...item, status: "Missing", evidence: "No written deliverable was produced." })),
  };
  reply(judgement);
  const response = await POST(request({ reviewType: "final", endReason: "stopped", canvas: "", conversation: [] }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { judgement });
});

test("one corrective model request can repair an unsupported final rating", async () => {
  const corrected = {
    ...final, verdict: "Needs more work",
    requirements: final.requirements.map((item) => ({ ...item, status: "Missing", evidence: "The canvas is empty." })),
  };
  const replies = [final, corrected];
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation( async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json({ message: { content: JSON.stringify(replies.shift()) } });
  });
  const response = await POST(request({ reviewType: "final", endReason: "stopped", canvas: "", conversation: [] }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { judgement: corrected });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, calls[1].model);
  assert.match(calls[1].messages.at(-1).content, /Mark Expected deliverable as Missing/);
});

test("cancelling a judge review cancels its model request", async () => {
  const controller = new AbortController();
  const incoming = request({}, controller.signal);
  vi.spyOn(globalThis, "fetch").mockImplementation( async (_url, { signal }) => {
    assert.equal(signal.aborted, false);
    controller.abort();
    signal.throwIfAborted();
  });
  assert.equal((await POST(incoming)).status, 502);
  assert.ok(incoming.signal.aborted);
});

test("malformed review request bodies are rejected before calling the model", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation( () => { throw new Error("Unexpected model call"); });
  for (const body of ["null", "[]", "{", "42"]) {
    assert.equal((await POST(new Request("http://localhost/api/scenario-judge", { method: "POST", body }))).status, 400);
  }
  assert.equal(fetch.mock.calls.length, 0);
});

test("a successful final verdict cannot contradict missing requirement ratings", async () => {
  const calls = reply({ ...final, verdict: "Meets requirements" });
  assert.equal((await POST(request({ reviewType: "final", endReason: "stopped" }))).status, 502);
  assert.equal(calls.length, 2);
  assert.match(calls[1].messages.at(-1).content, /requires every criterion to be Met/);
});

test("a late judge response is discarded even when the model ignores cancellation", async () => {
  const controller = new AbortController();
  vi.spyOn(globalThis, "fetch").mockImplementation( async () => {
    controller.abort();
    return Response.json({ message: { content: JSON.stringify(review) } });
  });
  assert.equal((await POST(request({}, controller.signal))).status, 502);
});

const letterReview = { summary: "A", strengths: ["R", "i", "l"], improvements: ["R", "e", "v"], nextPriorities: ["R", "e", "v"] };

test("judge decoding schemas allow full sentences without a single-character pattern", async () => {
  const calls = reply(review);
  await POST(request());
  assert.equal(calls[0].format.properties.summary.pattern, "[^\\n]*[.!?]");
  assert.ok(calls[0].format.properties.strengths.items.pattern.startsWith("The canvas records"));
  assert.ok(calls[0].format.properties.summary.minLength >= 8);
});

test("the single-letter review from the screenshot is rejected within the retry limit", async () => {
  const calls = reply(letterReview);
  const response = await POST(request());
  assert.equal(response.status, 502);
  assert.equal(calls.length, 2);
  const result = await response.json();
  assert.equal(result.code, "GENERATION_FAILED");
  assert.ok(!("text" in result));
});

test("fragmented final assessments cannot be published", async () => {
  const calls = reply({ ...final, ...letterReview, feedbackResponse: "A", requirements: final.requirements.map((item) => ({ ...item, evidence: "R" })) });
  const response = await POST(request({ reviewType: "final", endReason: "stopped" }));
  assert.equal(response.status, 502);
  assert.equal(calls.length, 2);
  assert.ok(!("judgement" in await response.json()));
});

test("an invalid finding is corrected before a checkpoint reaches the feed", async () => {
  const replies = [{ ...review, strengths: ["R i l e y"] }, review];
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json({ message: { content: JSON.stringify(replies.shift()) } });
  });
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(withoutLatency(await response.json()), { text: reviewMessage(review), tokenUsage: { input: null, output: null } });
  assert.equal(calls.length, 2);
  assert.match(calls[1].messages.at(-1).content, /meaningful|complete.*sentence/i);
});

test("a generation marked as truncated is retried even if its JSON parses", async () => {
  const replies = [{ message: { content: JSON.stringify(review) }, done_reason: "length" }, { message: { content: JSON.stringify(review) }, done_reason: "stop" }];
  let count = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => { count++; return Response.json(replies.shift()); });
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(count, 2);
  assert.deepEqual(withoutLatency(await response.json()), { text: reviewMessage(review), tokenUsage: { input: null, output: null } });
});

test("every narrative field rejects empty, single-word, or letter-fragment output while concise phrases remain valid", () => {
  for (const fragment of ["A", "R i l e y", "reviewreviewreview", "        "]) {
    for (const key of ["summary", "strengths", "improvements", "nextPriorities"]) {
      assert.equal(isJudgeReview({ ...review, [key]: key === "summary" ? fragment : [fragment] }), false);
    }
    const criteria = final.requirements.map((item) => item.criterion);
    assert.equal(isFinalJudgement({ ...final, feedbackResponse: fragment }, criteria), false);
    assert.equal(isFinalJudgement({ ...final, requirements: final.requirements.map((item, index) => index ? item : { ...item, evidence: fragment }) }, criteria), false);
  }
  assert.ok(isJudgeReview({ ...review, strengths: ["Clear scope."], improvements: ["No concerns."], nextPriorities: ["Validate measures."] }));
});

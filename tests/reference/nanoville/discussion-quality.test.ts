import { expect, test, vi } from "vitest";
import { groundingError } from "@/features/discussion/policies";
import { canvasMessages, spokenMessages, judgeMessages } from "@/features/discussion/server/prompts";
import { runTurn } from "@/features/discussion/server/run-turn";
import { reviewDiscussion } from "@/features/discussion/server/review";
import { canvasOutputTokens, finalOutputTokens, modelContextTokens } from "@/features/discussion/limits";
import { initialState, sessionReducer, nextWork } from "@/features/discussion/session";
import { inputTokenEstimate, type ModelCall } from "@/server/ollama";
import { judgementSchema, isJudgeReview } from "@/lib/judgement";
import { config } from "./fixtures/discussion";
import { scenarios } from "@/data/scenarios";
import type { TurnRequest, JudgeRequest } from "@/features/discussion/contracts";

const canvas = `## Scenario evidence\n\n> ${scenarios[0].problem}\n\n# Launch brief\n\n## Proposal\nUse human review during a narrow trial.\n\n## Open decisions\nConfirm retention approval with security.`;
const body: TurnRequest = { ...config, speakerId: "software-engineer", conversation: [], canvas };
const replace = (body: string) => ({ op: "REPLACE_SECTION", path: ["Launch brief", "Proposal"], body });
const reviewBody: JudgeRequest = { ...config, conversation: [], canvas, reviewType: "final", endReason: "stopped" };
const review = { summary: "The draft proposes a narrow trial.", strengths: ['The canvas proposes [human review].'], improvements: ["Retention approval remains open."], nextPriorities: ["Obtain security approval."] };
function replies(values: unknown[]) {
  return vi.fn<ModelCall>().mockImplementation(async () => {
    if (!values.length) throw new Error("Unexpected model call");
    const value = values.shift();
    return { message: { content: typeof value === "string" ? value : JSON.stringify(value) } };
  });
}

test("speech includes the full history and one canvas copy; final schema is not duplicated in the prompt", () => {
  const request = { ...body, conversation: [{ speakerName: "Jordan", text: "A complete earlier contribution." }] };
  const speech = spokenMessages(request, canvas, false);
  expect(JSON.stringify(speech).split(canvas.replaceAll("\n", "\\n"))).toHaveLength(2);
  expect(speech[1].content).toContain("A complete earlier contribution.");
  expect(speech[1].content).toContain("Scenario evidence");
  expect(judgeMessages(reviewBody).messages.map((message) => message.content).join("\n")).not.toContain('"properties"');
});

test("speech sees actual changed lines without duplicating the previous whole canvas", () => {
  const old = `${canvas}\n\nOwner: Jordan.\n${"Unchanged public context. ".repeat(100)}`;
  const revised = old.replace("Owner: Jordan.", "Owner: Riley.");
  const messages = spokenMessages({ ...body, canvas: old }, revised, true);
  expect(messages[1].content).toContain("Removed:\nOwner: Jordan.");
  expect(messages[1].content).toContain("Added:\nOwner: Riley.");
  expect(messages[1].content).not.toContain(old);
  expect(messages[1].content).toContain(revised);
});

test("a representative 20-turn history and bounded canvas fit every phase without dropping history", () => {
  const conversation: TurnRequest["conversation"] = Array.from({ length: 20 }, (_, index) => ({ speakerName: "Riley", text: `Contribution ${index + 1}: ${"Public evidence and an unresolved decision. ".repeat(12)}` }));
  for (const checkpoint of [15, 10, 5]) conversation.splice(checkpoint, 0, { kind: "judge", speakerName: "Judge", text: "Current requirement review. ".repeat(60) });
  const full = { ...body, maxTurns: 50, conversation, canvas: "Public proposal. ".repeat(350) };
  expect(inputTokenEstimate(canvasMessages(full)) + canvasOutputTokens).toBeLessThan(modelContextTokens);
  expect(inputTokenEstimate(spokenMessages(full, full.canvas, false)) + 300).toBeLessThan(modelContextTokens);
  const final = judgeMessages({ ...full, reviewType: "final", endReason: "stopped" });
  expect(inputTokenEstimate(final.messages, { format: judgementSchema(final.criteria) }) + finalOutputTokens).toBeLessThan(modelContextTokens);
  expect(final.messages[1].content).toContain("Contribution 20:");
});

test("an already oversized operation fails before generating a canvas", async () => {
  const model = replies([]);
  await expect(runTurn({ ...body, conversation: Array.from({ length: 20 }, () => ({ speakerName: "Riley", text: "x".repeat(1700) })) }, new AbortController().signal, model)).rejects.toMatchObject({ code: "CONTEXT_LIMIT" });
  expect(model).not.toHaveBeenCalled();
});

test("the no-change marker preserves the exact canvas and rejects an invented edit claim", async () => {
  const model = replies([{ op: "UNCHANGED" }, "I added a retention rule to the document.", "I propose asking security which retention period is acceptable.", "I feel cautious about retention approval."]);
  const result = await runTurn(body, new AbortController().signal, model);
  expect(result).toMatchObject({ canvas, toolActions: [], text: "I propose asking security which retention period is acceptable." });
  expect(model).toHaveBeenCalledTimes(4);
});

test("changing only a revision turn label is a no-edit turn, not a new contribution", async () => {
  const saved = `${canvas}\n\n**Revision Notes (Turn 16)**`;
  const model = replies([{ op: "REPLACE_SECTION", path: ["Launch brief", "Open decisions"], body: "Confirm retention approval with security.\n\n**Revision Notes (Turn 18)**" }, "I propose validating the approval owner before launch.", "I feel cautious about approval."]);
  expect(await runTurn({ ...body, canvas: saved }, new AbortController().signal, model)).toMatchObject({ canvas: saved, toolActions: [] });
  expect(model).toHaveBeenCalledTimes(3);
});

test.each([
  "Confirmed direct costs: $2,700.",
  "OAuth 2.0 support is confirmed by Product.",
  "CI logs show deployment v2.4.1 at 14:00 UTC.",
  "The outage lasted 45 minutes.",
])("unsupported observed claims are rejected: %s", (claim) => {
  expect(groundingError(claim, "A two-hour outage followed an update; scope remains unknown.")).toBeTruthy();
  expect(groundingError("Proposal: measure costs before deciding a spending cap.", "No cost data exists.")).toBeNull();
});

test("a confirmed-facts section title is not itself a factual assertion", () => {
  const evidence = "A two-hour outage followed an update.";
  expect(groundingError(`## Confirmed Facts & Open Hypotheses\n\n${evidence}\n\n## Proposal\nCollect missing logs before choosing a cause.`, evidence)).toBeNull();
  expect(groundingError("## Confirmed Facts\n\nMeasured direct costs were $2,700.", evidence)).toBeTruthy();
  expect(groundingError("**Confirmed Facts:**\n* **Confirmed:** Two-hour downtime; some requests failed outright, others delayed.", "A two-hour outage affected customers. Some requests failed outright, while others were delayed.")).toBeNull();
  expect(groundingError("**Confirmed:** The rollback was the sole cause of recovery.", "A rollback restored service, but its role in recovery is not confirmed.")).toBeTruthy();
  expect(groundingError("**Completion Check:** Verification of the measured delay value against the observed outage start time.", evidence)).toBeNull();
  expect(groundingError(`*Confirmed:* ${evidence}`, evidence)).toBeNull();
});

test("future verification milestones and questions are not claims of completed verification", () => {
  const evidence = "Product and Engineering have not confirmed integration scope.";
  expect(groundingError("Secure renewal by Day 45 with verified adoption metrics and a confirmed integration scope.", evidence)).toBeNull();
  expect(groundingError("Has Engineering confirmed the key connection scope?", evidence)).toBeNull();
  expect(groundingError("The integration will be verified during the pilot.", evidence)).toBeNull();
  expect(groundingError("**Confirmed:** The product supports standard API integrations; training materials exist.", evidence)).toBeTruthy();
});

test("unsupported confirmations are corrected before public output commits", async () => {
  const model = replies([replace("Confirmed direct costs: $2,700."), { op: "UNCHANGED" }, "I confirmed the measured costs were $2,700.", "I recorded retention approval as an open decision.", "I feel cautious about approval."]);
  expect(await runTurn(body, new AbortController().signal, model)).toMatchObject({ canvas, text: "I recorded retention approval as an open decision." });
  expect(model).toHaveBeenCalledTimes(5);
  expect(JSON.stringify(model.mock.calls[1][1])).not.toContain("$2,700");
});

test("unsupported capability retries explain how to record the unknown without retaining the rejected claim", async () => {
  const model = replies([replace("OAuth support is confirmed by Product."), replace("Integration readiness is Unknown pending Product and Engineering validation."), "I proposed an engineering readiness check before integration.", "I feel cautious about readiness."]);
  const result = await runTurn(body, new AbortController().signal, model);
  expect(result).toHaveProperty("canvas", expect.stringContaining("Integration readiness is Unknown"));
  expect(model.mock.calls[1][1].at(-1)!.content).toContain("Unknown — requires Product and Engineering validation");
  expect(JSON.stringify(model.mock.calls[1][1])).not.toContain("OAuth support is confirmed by Product");
});

test("the server preserves scenario evidence without relying on the model to copy it", async () => {
  const model = replies([{ op: "CREATE_DOCUMENT", document: "## Proposal\nRequire a named approver for each human review.\n\n## Open decisions\nConfirm the approver with support." }, "I added a proposed approval owner for human review.", "I feel cautious about ownership."]);
  const result = await runTurn({ ...body, canvas: "" }, new AbortController().signal, model);
  expect(result).toHaveProperty("canvas", expect.stringContaining(`> ${scenarios[0].problem}`));
  if (!result.skipped) expect(result.canvas.split(scenarios[0].problem)).toHaveLength(2);
});

test("model copies of scenario evidence do not accumulate after quote or heading changes", async () => {
  const copied = scenarios[0].problem.replace(/[‘’]/g, "'");
  const model = replies([{ op: "CREATE_DOCUMENT", document: `## Scenario Evidence\n\n${copied}\n\n## Proposal\nRequire a named approver for each human review.` }, { op: "CREATE_DOCUMENT", document: "## Proposal\nRequire a named approver for each human review." }, "I proposed a named approver for human review.", "I feel cautious about ownership."]);
  const result = await runTurn({ ...body, canvas: "" }, new AbortController().signal, model);
  if (result.skipped) throw new Error("Expected a public contribution");
  expect(result.canvas.match(/## Scenario evidence/gi)).toHaveLength(1);
  expect(result.canvas).toContain(scenarios[0].problem);
});

test("closing turns consolidate unresolved work instead of repeating the five-guideline cycle", () => {
  const early = canvasMessages(body);
  const closing = canvasMessages({ ...body, conversation: Array.from({ length: 17 }, () => ({ speakerName: "Riley", text: "Public contribution." })) });
  expect(early[1].content).toContain("most important unresolved scenario requirement");
  expect(closing[1].content).toContain("Closing turns: consolidate");
  const speech = spokenMessages({ ...body, conversation: Array.from({ length: 17 }, () => ({ speakerName: "Riley", text: "Public contribution." })) }, canvas, false);
  expect(speech[0].content).toContain("This is a closing turn");
  expect(speech[0].content).toContain("Do not ask peers to provide unavailable external facts");
  expect(speech[0].content).toContain("an observable validation check, and a fallback");
});

test.each(["The clause protects customer v", "The next gate is in", "The scope is ready for."])("judge fragments cannot pass validation: %s", (fragment) => {
  expect(isJudgeReview({ ...review, strengths: [fragment] })).toBe(false);
  expect(isJudgeReview(review)).toBe(true);
});

test("a judge cannot credit a spoken proposal missing from the current canvas", async () => {
  const model = replies([{ ...review, strengths: ['Skyler added the [People Health] checkpoint.'] }, review]);
  const result = await reviewDiscussion({ ...reviewBody, reviewType: "checkpoint", conversation: [{ speakerName: "Skyler", text: "I propose adding a People Health checkpoint." }] }, new AbortController().signal, model);
  expect(result).toHaveProperty("text", expect.stringContaining('[human review]'));
  expect(model).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(model.mock.calls[1][1])).not.toContain('Skyler added the');
});

test("empty-canvas reviews do not require invented citations for strengths", async () => {
  const model = vi.fn<ModelCall>().mockImplementation(async (_model, messages, _signal, options) => {
    expect(options!.format).toHaveProperty("properties.strengths.items.pattern", "No written deliverable exists yet\\.");
    expect(messages[0].content).toContain("do not invent canvas citations");
    return { message: { content: JSON.stringify({ ...review, strengths: ["No written deliverable exists yet."] }) } };
  });
  await expect(reviewDiscussion({ ...reviewBody, canvas: "", reviewType: "checkpoint" }, new AbortController().signal, model)).resolves.toHaveProperty("text");
});

test("a judge cannot say that its own verified citation is absent", async () => {
  const model = replies([{ ...review, improvements: ["The canvas lacks [human review]."] }, review]);
  const result = await reviewDiscussion({ ...reviewBody, reviewType: "checkpoint" }, new AbortController().signal, model);
  expect(result).toHaveProperty("text", expect.stringContaining("Retention approval remains open."));
  expect(model).toHaveBeenCalledTimes(2);
  const valid = replies([{ ...review, improvements: ["The [human review] proposal needs a named approver."] }]);
  await expect(reviewDiscussion({ ...reviewBody, reviewType: "checkpoint" }, new AbortController().signal, valid)).resolves.toHaveProperty("text");
});

test("supplied scenario evidence cannot be credited as the team's deliverable", async () => {
  const unsupported = { ...review, strengths: ["The canvas records [A support company is preparing] as a proposal."] };
  const model = replies([unsupported, review]);
  await expect(reviewDiscussion({ ...reviewBody, reviewType: "checkpoint" }, new AbortController().signal, model)).resolves.toHaveProperty("text");
  expect(model).toHaveBeenCalledTimes(2);
  const criteria = ["Expected deliverable", ...Array.from({ length: 5 }, (_, index) => `Guideline ${index + 1}`)];
  const final = { ...review, verdict: "Meets requirements", feedbackResponse: "No feedback was given.", requirements: criteria.map((criterion) => ({ criterion, status: "Met", evidence: "The scenario evidence is recorded." })) };
  await expect(reviewDiscussion({ ...reviewBody, canvas: `## Scenario evidence\n\n> ${scenarios[0].problem}` }, new AbortController().signal, replies([final, final]))).rejects.toMatchObject({ code: "GENERATION_FAILED" });
});

test("unchanged evidence-based concerns are labelled without forcing invented new feedback", async () => {
  const { reviewMessage } = await import("@/lib/judgement");
  const model = replies([{ ...review, summary: "The trial still needs retention approval." }]);
  const result = await reviewDiscussion({ ...reviewBody, reviewType: "checkpoint", conversation: [{ kind: "judge", speakerName: "Judge", text: reviewMessage(review) }] }, new AbortController().signal, model);
  expect(result).toHaveProperty("text", expect.stringContaining("Concerns unchanged after reviewing the current canvas."));
  expect(model).toHaveBeenCalledTimes(1);
});

test("context errors preserve saved work and cannot trigger a futile Resume loop", () => {
  let state = sessionReducer(initialState, { type: "START", config });
  state = sessionReducer(state, { type: "WORK_STARTED", id: 1, work: nextWork(state.session)! });
  state = sessionReducer(state, { type: "WORK_FAILED", id: 1, code: "CONTEXT_LIMIT", message: "Start a shorter discussion." });
  expect(state.errorCode).toBe("CONTEXT_LIMIT");
  expect(sessionReducer(state, { type: "RESUME" })).toBe(state);
  expect(nextWork(state.session)).toBeNull();
});

test("keyed final generation preserves every criterion and fits a 20-turn budget", async () => {
  const criteria = ["Expected deliverable", ...Array.from({ length: 5 }, (_, index) => `Guideline ${index + 1}`)];
  const conversation: TurnRequest["conversation"] = Array.from({ length: 20 }, (_, index) => ({ speakerName: "Riley", text: `Contribution ${index + 1}: ${"Public evidence and an unresolved decision. ".repeat(12)}` }));
  for (const checkpoint of [15, 10, 5]) conversation.splice(checkpoint, 0, { kind: "judge", speakerName: "Judge", text: "Current requirement review. ".repeat(60) });
  const document = `# Proposal\n\n${"Public proposal. ".repeat(350)}`;
  const model = vi.fn<ModelCall>().mockImplementation(async (_model, messages, _signal, options) => {
    expect(inputTokenEstimate(messages, options) + finalOutputTokens).toBeLessThan(modelContextTokens);
    const format = options!.format as { properties: { requirements: { type: string; required: string[] } } };
    expect(format.properties.requirements).toMatchObject({ type: "object", required: criteria });
    const assessment = (format.properties.requirements as unknown as { properties: Record<string, { properties: { evidence: { pattern: string } } }> }).properties[criteria[0]];
    expect(new RegExp(`^(?:${assessment.properties.evidence.pattern})$`).test("The current canvas contains an explicit proposed plan for [Public proposal. Public proposal. Public] but its supporting measurements still need independent verification before launch.")).toBe(true);
    return { message: { content: JSON.stringify({ ...review, strengths: ["The canvas records [Public proposal.] as a proposal."], verdict: "Partially meets requirements", feedbackResponse: "The public work remains proposed.", requirements: Object.fromEntries(criteria.map((criterion) => [criterion, { status: "Partially met", evidence: "The canvas records [Public proposal.] with unknowns." }])) }) } };
  });
  const result = await reviewDiscussion({ ...reviewBody, canvas: document, conversation }, new AbortController().signal, model);
  expect(result).toHaveProperty("judgement.requirements", criteria.map((criterion) => ({ criterion, status: "Partially met", evidence: "The canvas records [Public proposal.] with unknowns." })));
});

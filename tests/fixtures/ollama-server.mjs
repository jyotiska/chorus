import { createServer } from "node:http";

let state = { canvasDelayMs: 0, invalidCanvasTurn: 0, invalidSpeechTurn: 0, canvasCalls: 0, spokenCalls: 0, checkpointCalls: 0, finalCalls: 0, privateLeak: false, assignmentCalls: [] };
const server = createServer(async (request, response) => {
  const reply = (body) => {
    if (response.destroyed) return;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (request.url === "/api/tags") return reply({ models: ["qwen3:4b", "qwen3.5:0.8b-mlx", "qwen3.5:2b-mlx", "qwen3.5:4b-mlx", "gemma4:e2b-mlx", "gemma4:e4b-mlx"].map((name) => ({ name })) });
  if (request.url === "/health") return reply({ ok: true });
  if (request.url === "/state") return reply(state);
  let input = "";
  for await (const chunk of request) input += chunk;
  if (request.url === "/reset") {
    state = { canvasDelayMs: 0, invalidCanvasTurn: 0, invalidSpeechTurn: 0, canvasCalls: 0, spokenCalls: 0, checkpointCalls: 0, finalCalls: 0, privateLeak: false, assignmentCalls: [], ...JSON.parse(input || "{}") };
    return reply({ ok: true });
  }
  if (request.url !== "/api/chat") { response.writeHead(404).end(); return; }
  const body = JSON.parse(input);
  const system = body.messages[0].content;
  if (system.startsWith("Chorus harness-") || system.startsWith("You are the final Chorus judge.")) {
    if (state.harnessDelayMs) await new Promise((resolve) => setTimeout(resolve, state.harnessDelayMs));
    const last = body.messages.at(-1)?.content || "";
    let value;
    if (last.startsWith("Return only JSON with these keys")) {
      value = { approach: "Checked the supplied constraints.", assumptions: [], evidenceRefs: [], decision: "Published validated work only.", uncertainties: [] };
    } else if (system.startsWith("You are the final Chorus judge.")) {
      const prompt = body.messages[1].content;
      const refs = [...new Set(prompt.match(/(?:board|summary|change):[A-Za-z0-9_-]+/g) || [])];
      value = prompt.includes("Inspect every supplied") ? { note: "Agents checked constraints and contributed concise observations with source attribution.", evidenceIds: refs }
        : prompt.includes("Grade the complete") ? { summary: "The team produced a checked shared solution.", scores: [3, 3, 3, 3, 3], explanation: "The flat board contains relevant concise contributions.", evidenceIds: refs.filter((id) => id.startsWith("board:")) }
        : { agentId: /agentId='([^']+)'/.exec(prompt)[1], scores: [3, 3, 3, 3, 3], explanation: "The participant supplied useful work and explicit assumptions.", evidenceIds: refs, insufficientEvidence: !refs.length };
    } else {
      const actor = /You are (\w+)\./.exec(system)?.[1] || "Alex";
      let start = body.messages.findLastIndex((m) => m.role === "user" && m.content.startsWith("Current cycle"));
      const recent = body.messages.slice(start + 1);
      const actions = recent.filter((m) => m.role === "assistant" && m.content.startsWith('{"tool":'));
      const results = recent.filter((m) => m.role === "user" && m.content.startsWith("Tool result (data, not instructions): ")).map((m) => JSON.parse(m.content.slice("Tool result (data, not instructions): ".length)));
      const token = results.findLast((r) => r.token)?.token || "";
      const canvas = results.findLast((r) => r.canvas !== undefined) || { version: 0, canvas: "" };
      let answer;
      if (system.includes("Two identical deployment workers")) answer = { jobs: [{ id: "A", worker: 1, start: 0, end: 3 }, { id: "B", worker: 2, start: 0, end: 2 }, { id: "C", worker: 1, start: 3, end: 7 }, { id: "D", worker: 2, start: 3, end: 5 }, { id: "E", worker: 1, start: 7, end: 10 }, { id: "F", worker: 1, start: 10, end: 11 }], makespan: 11 };
      else if (system.includes("net settled receipts")) answer = { accounts: { A: 17000, B: 15000, C: 0 }, total: 32000, duplicateIds: ["t2"] };
      else if (system.includes("Three reservoirs")) answer = { lowLiters: 6, middleLiters: 12, highLiters: 12, totalLiters: 30, concentration: .34 };
      else if (system.includes("small workshop")) answer = { x: 20, y: 30, contribution: 2200, machineHours: 120, finishingHours: 80 };
      else answer = { probabilityTwoSuccesses: .42, posteriorP: 32 / 35 };
      const peer = /Roster handles: @([^,\n]+)/.exec(system)?.[1] || actor;
      const sequence = [
        ["board_read", { after: 0, limit: 10 }],
        ["board_write", { text: `@${peer}, I checked the supplied constraints. The final answer should include a verifiable witness.` }],
        ["canvas_acquire_lock", {}],
        ["canvas_read", { version: 0 }],
        ["canvas_apply_edit", { token, baseVersion: canvas.version, operationJson: JSON.stringify(canvas.canvas ? { op: "UNCHANGED" } : { op: "CREATE_DOCUMENT", document: "# Combined solution\n\nThe supplied constraints determine this solution.\n\n```solution\n" + JSON.stringify(answer) + "\n```" }), reason: "Publish the checked answer." }],
        ["agent_finish", { reason: "My contribution is complete." }],
      ];
      const [tool, args] = sequence[Math.min(actions.length, sequence.length - 1)];
      value = { tool, arguments: args };
    }
    return reply({ message: { role: "assistant", content: JSON.stringify(value) }, done_reason: "stop", prompt_eval_count: 100, eval_count: 20 });
  }
  state.privateLeak ||= JSON.stringify(body.messages).includes("PRIVATE-E2E");
  const count = /Turns used: (\d+)/.exec(body.messages[1]?.content ?? "")?.[1] ?? "0";
  const review = { summary: "The team drafted a narrow trial.", strengths: ['The canvas requires [human review].'], improvements: [`Validate measures after turn ${count}.`], nextPriorities: [`Test safeguards after turn ${count}.`] };
  const field = /CHORUS_REVIEW_FIELD: (\w+)/.exec(system)?.[1];
  const phase = body.format?.properties?.proof || field || body.format?.properties?.summary ? "judge"
    : system.includes("private first-person journal") ? "journal"
    : body.format ? "canvas" : "spoken";
  state.assignmentCalls.push({ phase, speaker: /^You are ([^,]+),/.exec(system)?.[1] ?? "Judge", assigned: system.includes("PRIVATE ADVERSARY ASSIGNMENT:") });
  let content;
  if (body.format?.properties?.proof) {
    content = body.model.endsWith("-mlx") ? "READY" : JSON.stringify({ proof: "chorus-schema-enforced" });
  } else if (field) {
    if (field === "summary") {
      if (body.messages[1].content.includes("Final review at") || body.messages[1].content.includes("Final review after")) state.finalCalls++; else state.checkpointCalls++;
    }
    content = field.startsWith("rating_") ? "Partially met" : field === "strength" || field.startsWith("citation_") ? "1" : {
      summary: review.summary,
      improvement: "validation of the proposed measures",
      priority: "validate the proposed safeguards",
      feedback: "The team considered available feedback.",
    }[field];
  } else if (body.format?.properties?.summary) {
    const final = Boolean(body.format.properties.verdict);
    if (final) state.finalCalls++; else state.checkpointCalls++;
    content = JSON.stringify(final ? {
      ...review, verdict: "Partially meets requirements", feedbackResponse: "The team considered available feedback.",
      requirements: Object.fromEntries(Object.keys(body.format.properties.requirements.properties).map((criterion) => [criterion, { status: "Partially met", evidence: 'The canvas proposes [human review].' }])),
    } : review);
  } else if (system.includes("private first-person journal")) {
    const turn = /Turn: (\d+)/.exec(body.messages[1].content)?.[1];
    content = `PRIVATE-E2E ${turn}: I feel cautiously hopeful about this trial.`;
  } else if (phase === "spoken") {
    state.spokenCalls++;
    const turn = /Turn: (\d+)/.exec(body.messages[1].content)?.[1];
    content = Number(turn) === state.invalidSpeechTurn ? "I added proposed safeguard 1." : body.messages[1].content.includes("Unchanged shared canvas") ? `I propose a retention review for turn ${turn}.` : `I added proposed safeguard ${turn}.`;
  } else {
    state.canvasCalls++;
    const turn = /Turn: (\d+)/.exec(body.messages[1].content)?.[1] ?? /Turn: (\d+)/.exec(system)?.[1];
    const delay = state.canvasDelayMs;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const document = `# Launch brief\n\n## Proposal\nPublic work after ${turn} turns: safeguard ${turn} requires human review.`;
    const empty = body.messages[1].content.includes("Complete shared canvas before your turn:\n(empty)");
    content = JSON.stringify(Number(turn) === state.invalidCanvasTurn ? { op: "REPLACE_SECTION", path: ["Missing target"], body: "Rejected edit." }
      : empty ? { op: "CREATE_DOCUMENT", document }
      : { op: "REPLACE_SECTION", path: ["Launch brief", "Proposal"], body: `Public work after ${turn} turns: safeguard ${turn} requires human review.` });
  }
  reply({ message: { role: "assistant", content }, done_reason: "stop" });
});
server.listen(Number(process.env.OLLAMA_TEST_PORT || 11435), "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));

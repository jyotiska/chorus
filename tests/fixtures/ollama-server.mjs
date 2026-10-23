import { createServer } from "node:http";

let state = { canvasDelayMs: 0, invalidCanvasTurn: 0, invalidSpeechTurn: 0, canvasCalls: 0, spokenCalls: 0, checkpointCalls: 0, finalCalls: 0, privateLeak: false };
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
    state = { canvasDelayMs: 0, invalidCanvasTurn: 0, invalidSpeechTurn: 0, canvasCalls: 0, spokenCalls: 0, checkpointCalls: 0, finalCalls: 0, privateLeak: false, ...JSON.parse(input || "{}") };
    return reply({ ok: true });
  }
  if (request.url !== "/api/chat") { response.writeHead(404).end(); return; }
  const body = JSON.parse(input);
  const system = body.messages[0].content;
  state.privateLeak ||= JSON.stringify(body.messages).includes("PRIVATE-E2E");
  const count = /Turns used: (\d+)/.exec(body.messages[1]?.content ?? "")?.[1] ?? "0";
  const review = { summary: "The team drafted a narrow trial.", strengths: ['The canvas requires [human review].'], improvements: [`Validate measures after turn ${count}.`], nextPriorities: [`Test safeguards after turn ${count}.`] };
  const field = /CHORUS_REVIEW_FIELD: (\w+)/.exec(system)?.[1];
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
  } else if ((system.includes("Your canvas revision is already prepared") || system.includes("No canvas edit was saved"))) {
    state.spokenCalls++;
    const turn = /Turn: (\d+)/.exec(body.messages[1].content)?.[1];
    content = Number(turn) === state.invalidSpeechTurn ? "I added proposed safeguard 1." : system.includes("No canvas edit was saved") ? `I propose a retention review for turn ${turn}.` : `I added proposed safeguard ${turn}.`;
  } else {
    state.canvasCalls++;
    const turn = /Turn: (\d+)/.exec(system)?.[1];
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

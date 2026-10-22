import { afterEach, expect, test, vi } from "vitest";
import { requestModel, inputTokenEstimate, type ModelCall, type OllamaMessage } from "@/server/ollama";
import { withDeadline } from "@/server/deadline";
import { journalTimeoutMs, modelCallTimeoutMs, modelContextTokens, operationTimeoutMs } from "@/features/discussion/limits";
import { turnRequestSchema } from "@/features/discussion/contracts";
import { runTurn } from "@/features/discussion/server/run-turn";
import { config } from "./fixtures/discussion";

const signal = () => new AbortController().signal;
const messages: OllamaMessage[] = [{ role: "user", content: "A short public task." }];
afterEach(() => vi.useRealTimers());

test("the adapter requests an explicit context window and logs metadata without prompt contents", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
    message: { content: "Done." }, prompt_eval_count: 42, eval_count: 7,
    load_duration: 10_000_000, prompt_eval_duration: 500_000_000, eval_duration: 200_000_000, total_duration: 750_000_000,
  }));
  await requestModel(config.model, messages, signal(), { phase: "canvas", attempt: 2, runId: "run-1" });
  const body = JSON.parse(String(fetch.mock.calls[0][1]!.body));
  expect(body.options.num_ctx).toBe(modelContextTokens);
  expect(body.stream).toBe(false);
  expect(log).toHaveBeenCalledOnce();
  const record = JSON.parse(log.mock.calls[0][0]);
  expect(record).toMatchObject({
    event: "model_call", phase: "canvas", attempt: 2, runId: "run-1", outcome: "success",
    promptTokens: 42, outputTokens: 7, loadDurationMs: 10, promptEvalDurationMs: 500, evalDurationMs: 200,
    ollamaTotalDurationMs: 750, promptTokensPerSecond: 84, outputTokensPerSecond: 35,
  });
  expect(JSON.stringify(record)).not.toContain("short public task");
});

test("oversized history fails before a request; decoding schemas do not consume prompt space", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  expect(inputTokenEstimate(messages, { format: { description: "large schema" } })).toBe(inputTokenEstimate(messages));
  await expect(requestModel(config.model, [{ role: "user", content: "x".repeat(modelContextTokens) }], signal())).rejects.toMatchObject({ code: "CONTEXT_LIMIT" });
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  [{ message: { content: 12 } }, "INVALID_MODEL_RESPONSE"],
  [null, "INVALID_MODEL_RESPONSE"],
])("malformed provider responses are rejected", async (body, code) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body));
  await expect(requestModel(config.model, messages, signal())).rejects.toMatchObject({ code });
});

test.each([
  [404, "model qwen not found", "MODEL_NOT_FOUND"],
  [503, "server busy", "MODEL_REQUEST_FAILED"],
])("provider status %i has a stable error category", async (status, error, code) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error }, { status }));
  await expect(requestModel(config.model, messages, signal())).rejects.toMatchObject({ code });
});

test("connection failures and unreadable JSON have distinct error categories", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"));
  await expect(requestModel(config.model, messages, signal())).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
  fetch.mockResolvedValueOnce(new Response("not JSON"));
  await expect(requestModel(config.model, messages, signal())).rejects.toMatchObject({ code: "INVALID_MODEL_RESPONSE" });
});

test("per-call deadlines settle even when the provider ignores cancellation", async () => {
  vi.useFakeTimers();
  let requestSignal!: AbortSignal;
  let resolve!: (response: Response) => void;
  vi.spyOn(globalThis, "fetch").mockImplementation((_url, options) => {
    requestSignal = options!.signal!;
    return new Promise((done) => { resolve = done; });
  });
  const pending = requestModel(config.model, messages, signal());
  const check = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
  await vi.advanceTimersByTimeAsync(modelCallTimeoutMs);
  await check;
  expect(requestSignal.aborted).toBe(true);
  resolve(Response.json({ message: { content: "Late reply" } }));
  expect(vi.getTimerCount()).toBe(0);
});

test("the operation deadline bounds a multi-stage operation and releases timers", async () => {
  vi.useFakeTimers();
  const check = expect(withDeadline(signal(), operationTimeoutMs, () => new Promise(() => {}))).rejects.toMatchObject({ code: "TIMEOUT" });
  await vi.advanceTimersByTimeAsync(operationTimeoutMs);
  await check;
  expect(vi.getTimerCount()).toBe(0);
});

test("parent cancellation propagates and a late adapter result is ignored", async () => {
  const controller = new AbortController();
  let child!: AbortSignal;
  let resolve!: (value: string) => void;
  const pending = withDeadline(controller.signal, 1000, (signal) => {
    child = signal;
    return new Promise<string>((done) => { resolve = done; });
  });
  const check = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort(); await check;
  expect(child.aborted).toBe(true);
  resolve("Late");
});

test("a stalled journal times out while preserving validated public work", async () => {
  vi.useFakeTimers();
  const call = vi.fn<ModelCall>()
    .mockResolvedValueOnce({ message: { content: JSON.stringify({ op: "CREATE_DOCUMENT", document: "# Brief\n\n## Proposal\nUse human review during the trial." }) } })
    .mockResolvedValueOnce({ message: { content: "I added mandatory human review during the trial." } })
    .mockImplementationOnce(() => new Promise(() => {}));
  const body = turnRequestSchema.parse({ ...config, speakerId: "software-engineer", canvas: "", conversation: [] });
  const pending = runTurn(body, signal(), call);
  await vi.advanceTimersByTimeAsync(journalTimeoutMs);
  const result = await pending;
  expect(result).toMatchObject({ canvas: expect.stringContaining("human review"), text: expect.stringContaining("mandatory"), innerVoice: null });
  expect(call).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

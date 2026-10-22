// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useDiscussion } from "@/features/discussion/client/use-discussion";
import { clientTimeoutMs } from "@/features/discussion/limits";
import ScenarioStudio from "@/components/scenario-studio";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { JudgeRequest, TurnRequest } from "@/features/discussion/contracts";
import { config, judgement, turn } from "./fixtures/discussion";

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => { cleanup(); vi.useRealTimers(); });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const select = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
const feed = () => within(screen.getByRole("complementary", { name: "Chat conversation" }));
async function step() { await act(async () => { await vi.advanceTimersByTimeAsync(1800); }); }
function setup() { render(<StrictMode><TooltipProvider><ScenarioStudio /></TooltipProvider></StrictMode>); }
function replies() {
  const requests: { url: string; body: TurnRequest & Partial<JudgeRequest>; signal: AbortSignal }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    const body: TurnRequest & Partial<JudgeRequest> = JSON.parse(String(options!.body));
    requests.push({ url: String(url), body, signal: options!.signal! });
    const number = body.conversation.filter((line) => line.kind !== "judge").length + 1;
    return Response.json(body.reviewType === "final" ? { judgement } : body.reviewType === "checkpoint" ? { text: "Checkpoint: define measures." } : turn(number));
  });
  return requests;
}
function start() { click(/Enter discussion/); }
async function journal(name = "Riley Chen") {
  await act(async () => { click(name); });
  await act(async () => { click("Inner voice"); });
  return within(screen.getByRole("complementary", { name: "Inner voice" }));
}

test("a final context error keeps the final document readable and disables futile retries", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const body = JSON.parse(String(options!.body));
    return body.reviewType === "final"
      ? Response.json({ code: "CONTEXT_LIMIT", error: "The full discussion exceeds the budget." }, { status: 502 })
      : Response.json(turn(body.conversation.length + 1));
  });
  setup(); select("Number of turns", "5"); select("Judge", "yes"); start();
  for (let index = 0; index < 6; index++) await step();
  expect(screen.getByRole("heading", { name: "Final document" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "▶ Resume" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Public work after 5 turns.")).toBeTruthy();
  expect(screen.getByText(/Return to setup to start a shorter discussion/)).toBeTruthy();
});

test("the judge defaults to No, the last turn preserves the same document, and completion schedules no summary", async () => {
  setup();
  expect((screen.getByLabelText("Judge") as HTMLSelectElement).value).toBe("no");
  select("Number of turns", "5");
  const requests = replies(); start();
  for (let i = 0; i < 5; i++) await step();
  expect(requests).toHaveLength(5);
  expect(requests.at(-1)!.body.conversation).toHaveLength(4);
  expect(screen.getByRole("heading", { name: "Final document" })).toBeTruthy();
  expect(screen.getByText("Public work after 5 turns.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "■ Stop" }) as HTMLButtonElement).disabled).toBe(true);
  await step(); expect(requests).toHaveLength(5);
});

test("20 turns include three checkpoints and a final panel with unchanged rotation and private journals excluded", async () => {
  setup(); select("Judge", "yes"); select("Ollama model", "qwen3.5:2b-mlx");
  const requests = replies(); start();
  expect(screen.getAllByRole("button", { name: /^About / })).toHaveLength(6);
  for (let i = 0; i < 24; i++) await step();
  const reviews = requests.filter(({ body }) => body.reviewType);
  const agents = requests.filter(({ body }) => !body.reviewType);
  expect(agents).toHaveLength(20);
  expect(reviews.map(({ body }) => [body.reviewType, body.conversation.filter((line) => line.kind === "agent").length])).toEqual([["checkpoint", 5], ["checkpoint", 10], ["checkpoint", 15], ["final", 20]]);
  expect(agents.slice(5, 10).map(({ body }) => body.speakerId)).toEqual(agents.slice(0, 5).map(({ body }) => body.speakerId));
  expect(agents[5].body.conversation.at(-1)!.kind).toBe("judge");
  expect(requests.every(({ body }) => body.model === "qwen3.5:2b-mlx")).toBe(true);
  expect(JSON.stringify(requests)).not.toMatch(/PRIVATE-JOURNAL|innerVoice/);
  expect(feed().getAllByRole("article")).toHaveLength(23);
  expect(feed().queryByText(judgement.summary)).toBeNull();
  expect(screen.getByText(judgement.summary)).toBeTruthy();
  await step(); expect(requests).toHaveLength(24);
});

test("a five-turn discussion goes directly to final review and a new session clears judgement", async () => {
  setup(); select("Judge", "yes"); select("Number of turns", "5");
  const requests = replies(); start();
  for (let i = 0; i < 6; i++) await step();
  expect(requests.filter(({ body }) => body.reviewType).map(({ body }) => body.reviewType)).toEqual(["final"]);
  click("← Back to setup"); select("Judge", "no"); start();
  expect(screen.queryByRole("heading", { name: "Final judgement" })).toBeNull();
  expect(screen.queryByRole("button", { name: "About Judge" })).toBeNull();
  await step(); click("■ Stop");
  expect(requests).toHaveLength(7);
});

test("early stop at a checkpoint reviews the completed canvas and skips that checkpoint", async () => {
  setup(); select("Judge", "yes"); const requests = replies(); start();
  for (let i = 0; i < 5; i++) await step();
  click("■ Stop"); await step();
  expect(requests.at(-1)!.body.reviewType).toBe("final");
  expect(requests.at(-1)!.body.endReason).toBe("stopped");
  expect(requests.at(-1)!.body.canvas).toBe(turn(5).canvas);
  expect(screen.getByText("Early-stop review")).toBeTruthy();
  expect(feed().getAllByRole("article")).toHaveLength(5);
});

test("failed participant work preserves the document and Resume retries the same request", async () => {
  setup(); let fail = true; const requests: unknown[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const body = JSON.parse(String(options!.body)); requests.push(body);
    return body.conversation.length === 2 && fail ? Response.json({ code: "GENERATION_FAILED", error: "Invalid canvas" }, { status: 502 }) : Response.json(turn(body.conversation.length + 1));
  });
  start(); for (let i = 0; i < 3; i++) await step();
  expect(screen.getByRole("alert").textContent).toContain("Discussion paused");
  expect(screen.getByText("Public work after 2 turns.")).toBeTruthy();
  expect(feed().getAllByRole("article")).toHaveLength(2);
  fail = false; click("▶ Resume"); await step();
  expect(requests[3]).toEqual(requests[2]);
  expect(feed().getAllByRole("article")).toHaveLength(3);
});

test("checkpoint and final review failures resume the review without replaying a contribution", async () => {
  setup(); select("Judge", "yes"); let fail = true; const kinds: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const body = JSON.parse(String(options!.body)); kinds.push(body.reviewType ?? "turn");
    return !body.reviewType ? Response.json(turn(body.conversation.filter((line: { kind: string }) => line.kind === "agent").length + 1))
      : fail ? Response.json({ code: "MODEL_UNAVAILABLE", error: "Judge unavailable" }, { status: 502 })
      : Response.json(body.reviewType === "final" ? { judgement } : { text: "Checkpoint feedback" });
  });
  start(); for (let i = 0; i < 6; i++) await step();
  expect(screen.getByRole("alert").textContent).toContain("Judge review paused");
  fail = false; click("▶ Resume"); await step();
  expect(feed().getAllByRole("article")).toHaveLength(6);
  fail = true; click("■ Stop"); await step();
  fail = false; click("▶ Resume"); await step();
  expect(kinds.slice(-2)).toEqual(["final", "final"]);
  expect(kinds.filter((kind) => kind === "turn")).toHaveLength(5);
  expect(screen.getByText(judgement.summary)).toBeTruthy();
});

test.each(["Ⅱ Pause", "■ Stop", "← Back to setup"])("%s immediately cancels in-flight work and discards late public and private results", async (control) => {
  setup(); let resolve!: (response: Response) => void; let signal!: AbortSignal;
  vi.spyOn(globalThis, "fetch").mockImplementation((_url, options) => { signal = options!.signal!; return new Promise((done) => { resolve = done; }); });
  start(); await step(); click(control);
  expect(signal.aborted).toBe(true);
  await act(async () => { resolve(Response.json({ ...turn(1), text: "Late reply", canvas: "Late canvas", innerVoice: "Late journal" })); });
  expect(screen.queryByText("Late reply")).toBeNull();
  expect(screen.queryByText("Late canvas")).toBeNull();
  expect(screen.queryByText("Late journal")).toBeNull();
});

test("pausing a scheduled turn cancels its timer and Resume schedules only one request", async () => {
  setup(); const requests = replies(); start(); click("Ⅱ Pause"); await step(); expect(requests).toHaveLength(0);
  click("▶ Resume"); await step(); expect(requests).toHaveLength(1);
});

test.each(["Ⅱ Pause", "← Back to setup"])("%s cancels a pending judge review and rejects late feedback", async (control) => {
  setup(); select("Judge", "yes"); let resolve!: (response: Response) => void; let signal!: AbortSignal;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const body = JSON.parse(String(options!.body));
    if (!body.reviewType) return Response.json(turn(body.conversation.length + 1));
    signal = options!.signal!; return new Promise((done) => { resolve = done; });
  });
  start(); for (let i = 0; i < 6; i++) await step();
  click(control); expect(signal.aborted).toBe(true);
  await act(async () => { resolve(Response.json({ text: "Late feedback" })); });
  expect(screen.queryByText("Late feedback")).toBeNull();
});

test("journals record while closed, retain full text, filter newest first, and survive pause and stop", async () => {
  setup(); const requests = replies(); start();
  for (let i = 0; i < 6; i++) await step();
  click("Ⅱ Pause");
  expect(screen.queryByText("PRIVATE-JOURNAL 1")).toBeNull();
  let panel = await journal();
  expect(panel.getAllByRole("article").map((entry) => entry.textContent)).toEqual([expect.stringContaining("PRIVATE-JOURNAL 6"), expect.stringContaining("PRIVATE-JOURNAL 1")]);
  expect(panel.getAllByRole("time").every((entry) => Number.isFinite(Date.parse(entry.getAttribute("datetime")!)))).toBe(true);
  click("Close inner voice");
  panel = await journal("Jordan Brooks");
  expect(panel.getByText("PRIVATE-JOURNAL 2")).toBeTruthy();
  expect(panel.queryByText("PRIVATE-JOURNAL 1")).toBeNull();
  click("■ Stop"); expect(panel.getByText("PRIVATE-JOURNAL 2")).toBeTruthy();
  click("← Back to setup"); start(); panel = await journal();
  expect(panel.queryAllByRole("article")).toHaveLength(0);
  expect(panel.getByText("Their inner voice will appear after their first completed turn.")).toBeTruthy();
  expect(JSON.stringify(requests)).not.toMatch(/PRIVATE-JOURNAL|innerVoice/);
});

test("the journal renders complete long entries and marks unavailable entries", async () => {
  setup(); const thought = "I feel uncertain about whether the safeguards can work during a busy support shift, and I appreciate how carefully the team is considering the risks. The details still need patient attention.";
  let count = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ...turn(++count), innerVoice: count === 1 ? thought : null }));
  start(); for (let i = 0; i < 6; i++) await step(); click("Ⅱ Pause");
  const panel = await journal();
  expect(panel.getByText(thought)).toBeTruthy();
  expect(panel.getByText("Inner voice unavailable for this turn.")).toBeTruthy();
});

test("opening and closing the journal does not cancel pending work or create another request", async () => {
  setup(); let signal!: AbortSignal;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((_url, options) => { signal = options!.signal!; return new Promise(() => {}); });
  start(); await step(); await journal(); click("Close inner voice");
  expect(signal.aborted).toBe(false); await step(); expect(fetch).toHaveBeenCalledTimes(1);
});

test("malformed successful responses pause safely without corrupting completed work", async () => {
  setup(); let count = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(++count === 1 ? turn(1) : { canvas: 12, text: [] }));
  start(); await step(); await step();
  expect(screen.getByRole("alert").textContent).toContain("invalid turn");
  expect(screen.getByText("Public work after 1 turns.")).toBeTruthy();
  expect(feed().getAllByRole("article")).toHaveLength(1);
});

test("the browser deadline pauses a stalled request even when fetch ignores cancellation", async () => {
  let signal!: AbortSignal;
  vi.spyOn(globalThis, "fetch").mockImplementation((_url, options) => { signal = options!.signal!; return new Promise(() => {}); });
  const { result } = renderHook(useDiscussion);
  act(() => result.current.start(config));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { await vi.advanceTimersByTimeAsync(clientTimeoutMs); });
  expect(signal.aborted).toBe(true);
  expect(result.current.session.status).toBe("paused");
  expect(result.current.session.turns).toHaveLength(0);
  expect(result.current.error).toContain("too long");
  expect(vi.getTimerCount()).toBe(0);
});

test.each([false, true])("cancellation releases the browser deadline and rejects obsolete work after Resume (skipped: %s)", async (skipped) => {
  let resolve!: (response: Response) => void;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
    .mockResolvedValueOnce(Response.json(turn(1)));
  const { result } = renderHook(useDiscussion);
  act(() => result.current.start(config));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(vi.getTimerCount()).toBe(1);
  act(() => result.current.pauseOrResume());
  expect(vi.getTimerCount()).toBe(0);
  act(() => result.current.pauseOrResume());
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { resolve(Response.json(skipped ? { skipped: true } : turn(99))); });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.current.session.canvas).toBe(turn(1).canvas);
  expect(result.current.session.turns).toHaveLength(1);
});

test("a no-edit turn preserves the canvas, shows a quiet note, and automatically advances to the next participant", async () => {
  setup();
  const requests: TurnRequest[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const body: TurnRequest = JSON.parse(String(options!.body));
    requests.push(body);
    return Response.json(requests.length === 2 ? { ...turn(2), canvas: body.canvas, toolActions: [] } : turn(requests.length));
  });
  start(); await step(); await step();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Public work after 1 turns.")).toBeTruthy();
  expect(feed().getByText("Canvas unchanged this turn")).toBeTruthy();
  expect(feed().getAllByRole("article")).toHaveLength(2);
  await step();
  expect(requests[2].canvas).toBe(turn(1).canvas);
  expect(requests[2].conversation).toHaveLength(2);
  expect(requests[2].speakerId).not.toBe(requests[1].speakerId);
  expect(feed().getAllByRole("article")).toHaveLength(3);
});

test("a skipped reply preserves saved work and continues through final review without Resume", async () => {
  setup(); select("Judge", "yes"); select("Number of turns", "5");
  const requests: (TurnRequest & Partial<JudgeRequest>)[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const body: TurnRequest & Partial<JudgeRequest> = JSON.parse(String(options!.body));
    requests.push(body);
    const number = body.conversation.filter((line) => line.kind !== "judge").length + 1;
    return Response.json(body.reviewType ? { judgement } : number === 2 ? { skipped: true } : turn(number));
  });
  start(); await step(); await step();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Public work after 1 turns.")).toBeTruthy();
  const notice = feed().getByText("System notice · Turn 2 skipped").closest("article")!;
  expect(within(notice).queryByText("Canvas unchanged this turn")).toBeNull();
  expect(within(notice).queryByText("✎ Updated the common canvas")).toBeNull();
  expect(screen.queryByRole("button", { name: "About Jordan Brooks · Speaking" })).toBeNull();
  for (let i = 0; i < 4; i++) await step();
  expect(requests).toHaveLength(6);
  expect(requests[2].speakerId).not.toBe(requests[1].speakerId);
  expect(requests[2].canvas).toBe(turn(1).canvas);
  expect(requests[2].conversation[1]).toEqual({ kind: "skipped", speakerName: "Jordan Brooks", text: "" });
  expect(requests.at(-1)!.reviewType).toBe("final");
  expect(feed().getAllByRole("article")).toHaveLength(5);
  expect(screen.getByText(judgement.summary)).toBeTruthy();
  expect((await journal("Jordan Brooks")).queryAllByRole("article")).toHaveLength(0);
});

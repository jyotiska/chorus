import { expect, test } from "vitest";
import { initialState, nextWork, sessionReducer, sessionView, type SessionState } from "@/features/discussion/session";
import { config, judgement, turn } from "./fixtures/discussion";

function complete(state: SessionState, id: number) {
  const work = nextWork(state.session)!;
  const started = sessionReducer(state, { type: "WORK_STARTED", id, work });
  return work.kind === "turn" ? sessionReducer(started, { type: "TURN_COMPLETED", id, response: turn(id), createdAt: "2026-01-01T00:00:00.000Z" })
    : work.kind === "checkpoint" ? sessionReducer(started, { type: "CHECKPOINT_COMPLETED", id, text: "Define measures." })
    : sessionReducer(started, { type: "FINAL_COMPLETED", id, judgement });
}

test("20 turns rotate participants and include exactly three checkpoints and a final review", () => {
  let state = sessionReducer(initialState, { type: "START", config: { ...config, judgeEnabled: true } });
  const work = [];
  for (let id = 1; id <= 24; id++) {
    work.push(nextWork(state.session));
    state = complete(state, id);
  }
  expect(work.filter((item) => item?.kind === "checkpoint")).toHaveLength(3);
  const speakers = work.filter((item) => item?.kind === "turn").map((item) => item?.speakerId);
  expect(speakers).toEqual(Array.from({ length: 20 }, (_, i) => config.participantIds[i % 2]));
  expect(state.session.status).toBe("completed");
  expect(state.session.turns).toHaveLength(23);
  expect(state.session.innerVoice).toHaveLength(20);
  expect(state.session.finalJudgement).toEqual(judgement);
  expect(nextWork(state.session)).toBeNull();
});

test.each([5, 10, 100])("%i turns end directly with a final review", (maxTurns) => {
  let state = sessionReducer(initialState, { type: "START", config: { ...config, maxTurns, judgeEnabled: true } });
  let id = 0;
  while (sessionView(state.session).completedTurns < maxTurns) state = complete(state, ++id);
  expect(nextWork(state.session)).toEqual({ kind: "final" });
  expect(state.session.turns.filter((line) => line.kind === "judge")).toHaveLength(maxTurns / 5 - 1);
});

test.each(["PAUSE", "STOP", "BACK"] as const)("%s invalidates pending work and ignores late success or failure", (type) => {
  let state = sessionReducer(initialState, { type: "START", config });
  state = complete(state, 1);
  state = sessionReducer(state, { type: "WORK_STARTED", id: 2, work: nextWork(state.session)! });
  const cancelled = sessionReducer(state, { type });
  expect(sessionReducer(cancelled, { type: "TURN_COMPLETED", id: 2, response: turn(2), createdAt: "late" })).toBe(cancelled);
  expect(sessionReducer(cancelled, { type: "WORK_FAILED", id: 2, message: "late failure" })).toBe(cancelled);
  expect(cancelled.session.canvas).toBe(turn(1).canvas);
});

test("a failed turn preserves all public and private work and resumes the same speaker", () => {
  let state = sessionReducer(initialState, { type: "START", config });
  state = complete(state, 1);
  const work = nextWork(state.session)!;
  const started = sessionReducer(state, { type: "WORK_STARTED", id: 2, work });
  const failed = sessionReducer(started, { type: "WORK_FAILED", id: 2, message: "Retry" });
  expect(failed.session.canvas).toBe(state.session.canvas);
  expect(failed.session.turns).toBe(state.session.turns);
  expect(failed.session.innerVoice).toBe(state.session.innerVoice);
  expect(failed.session.status).toBe("paused");
  expect(nextWork(sessionReducer(failed, { type: "RESUME" }).session)).toEqual(work);
});

test("early stop supersedes a checkpoint and a paused final review resumes without another participant", () => {
  let state = sessionReducer(initialState, { type: "START", config: { ...config, judgeEnabled: true } });
  for (let i = 1; i <= 5; i++) state = complete(state, i);
  expect(nextWork(state.session)).toEqual({ kind: "checkpoint" });
  state = sessionReducer(state, { type: "STOP" });
  state = sessionReducer(state, { type: "PAUSE" });
  state = sessionReducer(state, { type: "RESUME" });
  expect(nextWork(state.session)).toEqual({ kind: "final" });
  state = complete(state, 6);
  expect(state.session.status).toBe("stopped");
  expect(state.session.turns).toHaveLength(5);
});

test("only one matching operation can start, mismatched responses are ignored, and a new session clears work", () => {
  let state = sessionReducer(initialState, { type: "START", config });
  const work = nextWork(state.session)!;
  expect(sessionReducer(state, { type: "WORK_STARTED", id: 1, work: { kind: "final" } })).toBe(state);
  state = sessionReducer(state, { type: "WORK_STARTED", id: 1, work });
  expect(sessionReducer(state, { type: "WORK_STARTED", id: 2, work })).toBe(state);
  expect(sessionReducer(state, { type: "CHECKPOINT_COMPLETED", id: 1, text: "Wrong kind" })).toBe(state);
  expect(sessionReducer(state, { type: "TURN_COMPLETED", id: 9, response: turn(1), createdAt: "late" })).toBe(state);
  const fresh = sessionReducer(sessionReducer(state, { type: "TURN_COMPLETED", id: 1, response: turn(1), createdAt: "2026-01-01T00:00:00Z" }), { type: "START", config });
  expect(fresh.session.turns).toEqual([]);
  expect(fresh.session.innerVoice).toEqual([]);
  expect(fresh.session.finalJudgement).toBeNull();
});

test("discussion-only contributions count toward checkpoints and preserve speaker rotation", () => {
  let state = sessionReducer(initialState, { type: "START", config: { ...config, judgeEnabled: true } });
  state = complete(state, 1);
  const canvas = state.session.canvas;
  for (let id = 2; id <= 5; id++) {
    const work = nextWork(state.session)!;
    expect(work).toEqual({ kind: "turn", speakerId: config.participantIds[(id - 1) % 2] });
    state = sessionReducer(state, { type: "WORK_STARTED", id, work });
    state = sessionReducer(state, { type: "TURN_COMPLETED", id, response: { ...turn(id), canvas, toolActions: [] }, createdAt: "2026-01-01T00:00:00Z" });
  }
  expect(state.session.canvas).toBe(canvas);
  expect(state.session.turns).toHaveLength(5);
  expect(state.session.innerVoice).toHaveLength(5);
  expect(nextWork(state.session)).toEqual({ kind: "checkpoint" });
});

test.each([false, true])("skipped turns advance rotation and finish a bounded discussion (judge: %s)", (judgeEnabled) => {
  let state = sessionReducer(initialState, { type: "START", config: { ...config, judgeEnabled, maxTurns: 10 } });
  state = complete(state, 1);
  const canvas = state.session.canvas;
  const journal = state.session.innerVoice;
  let id = 1;
  for (let number = 2; number <= 10; number++) {
    const work = nextWork(state.session)!;
    expect(work).toEqual({ kind: "turn", speakerId: config.participantIds[(number - 1) % 2] });
    state = sessionReducer(state, { type: "WORK_STARTED", id: ++id, work });
    state = sessionReducer(state, { type: "TURN_COMPLETED", id, response: { skipped: true }, createdAt: "2026-01-01T00:00:00Z" });
    expect(state.error).toBe("");
    expect(state.session.canvas).toBe(canvas);
    expect(state.session.innerVoice).toBe(journal);
    expect(state.session.turns.at(-1)).toMatchObject({ kind: "skipped", turnNumber: number, text: "", actions: [] });
    if (judgeEnabled && number === 5) {
      expect(nextWork(state.session)).toEqual({ kind: "checkpoint" });
      state = complete(state, ++id);
    }
  }
  if (judgeEnabled) {
    expect(nextWork(state.session)).toEqual({ kind: "final" });
    state = complete(state, ++id);
  }
  expect(state.session.status).toBe("completed");
  expect(nextWork(state.session)).toBeNull();
});

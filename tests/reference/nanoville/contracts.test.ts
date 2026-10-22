import { expect, test } from "vitest";
import { turnRequestSchema, judgeRequestSchema, turnResponseSchema, errorResponseSchema } from "@/features/discussion/contracts";
import { config, turn } from "./fixtures/discussion";

const request = { ...config, speakerId: "software-engineer", canvas: "", conversation: [] };
test("request contracts discard observer-only fields and normalize the default model", () => {
  const parsed = turnRequestSchema.parse({ ...request, model: null, innerVoice: ["secret"] });
  expect(parsed.model).toBe(config.model);
  expect(parsed).not.toHaveProperty("innerVoice");
  expect(parsed).not.toHaveProperty("judgeEnabled");
});
test.each([
  { participantIds: ["software-engineer", "software-engineer"] },
  { participantIds: ["software-engineer", "unknown"] },
  { speakerId: "judge" }, { model: "unknown" }, { maxTurns: 101 },
  { conversation: [{ speakerName: "Riley", text: 123 }] }, { canvas: "x".repeat(20001) },
])("invalid request data is rejected: %j", (override) => {
  expect(turnRequestSchema.safeParse({ ...request, ...override }).success).toBe(false);
});
test("judge review timing uses the same rules as the session model", () => {
  const conversation = Array.from({ length: 5 }, () => ({ kind: "agent", speakerName: "Riley", text: "Work" }));
  expect(judgeRequestSchema.safeParse({ ...request, conversation, reviewType: "checkpoint" }).success).toBe(true);
  expect(judgeRequestSchema.safeParse({ ...request, conversation, reviewType: "checkpoint", maxTurns: 5 }).success).toBe(false);
  expect(judgeRequestSchema.safeParse({ ...request, conversation, reviewType: "final", endReason: "turn-limit", maxTurns: 5 }).success).toBe(true);
});
test("response contracts reject invalid payloads and preserve successful shapes", () => {
  expect(turnResponseSchema.parse(turn(1))).toEqual(turn(1));
  expect(turnResponseSchema.safeParse({ text: "Fine", canvas: 12 }).success).toBe(false);
  expect(errorResponseSchema.parse({ error: "Timed out", code: "TIMEOUT" })).toEqual({ error: "Timed out", code: "TIMEOUT" });
});

test("a discussion-only turn accepts an unchanged or empty canvas without a fake update action", () => {
  const response = { ...turn(1), canvas: "", toolActions: [] };
  expect(turnResponseSchema.parse(response)).toEqual(response);
});

test("skipped turns carry no generated contribution, canvas edit, or journal", () => {
  expect(turnResponseSchema.parse({ skipped: true })).toEqual({ skipped: true });
  expect(turnResponseSchema.safeParse({ ...turn(1), skipped: true }).success).toBe(false);
  const conversation = [{ kind: "skipped", speakerName: "Riley", text: "" }];
  expect(turnRequestSchema.safeParse({ ...request, conversation }).success).toBe(true);
  expect(turnRequestSchema.safeParse({ ...request, conversation: [{ ...conversation[0], text: "Invented speech" }] }).success).toBe(false);
});

import { expect, test } from "vitest";
import { canvasEditSchema, type CanvasEdit } from "@/features/discussion/contracts";
import { applyCanvasEdit, canvasHeadingPaths, scenarioEvidenceBlock } from "@/features/discussion/server/canvas-edits";

const evidence = "A supplied fact with ‘original’ punctuation.";
const prefix = `${scenarioEvidenceBlock(evidence)}\n\n`;
const document = "# Brief\n\n## Proposal\n\nOriginal scope.\n\n### Safeguards\n\nKeep human review.\n\n## Open decisions\n\n### Safeguards\n\nConfirm approval.\n";
const canvas = prefix + document;
const replace = (body: string): CanvasEdit => ({ op: "REPLACE_SECTION", path: ["Brief", "Proposal"], body });
const append = (parentPath: string[], heading = "Owners"): Extract<CanvasEdit, { op: "APPEND_SECTION" }> => ({ op: "APPEND_SECTION", parentPath, heading, body: "Proposed owner: support." });

test("creation excludes model evidence and adds the exact server-owned evidence once", () => {
  expect(applyCanvasEdit("", evidence, { op: "CREATE_DOCUMENT", document }).canvas).toBe(prefix + document.trim());
  expect(applyCanvasEdit(" \n", evidence, { op: "CREATE_DOCUMENT", document }).canvas).toContain(evidence);
  expect(() => applyCanvasEdit(canvas, evidence, { op: "CREATE_DOCUMENT", document })).toThrow(expect.objectContaining({ category: "INVALID_OPERATION" }));
});

test("creation cannot flatten the complete document onto one heading line", () => {
  expect(() => applyCanvasEdit("", evidence, { op: "CREATE_DOCUMENT", document: "# Brief ## Proposal Trial routine requests with human review. ## Open decisions Confirm retention." }))
    .toThrow(expect.objectContaining({ category: "EMPTY_DOCUMENT" }));
});

test.each(["", canvas])("UNCHANGED preserves the exact committed string: %j", (current) => {
  expect(applyCanvasEdit(current, evidence, { op: "UNCHANGED" }).canvas).toBe(current);
});

test("replacement preserves its heading, descendants, siblings, evidence, and untouched bytes", () => {
  const result = applyCanvasEdit(canvas, evidence, replace("Revised proposed scope."));
  expect(result.canvas).toBe(canvas.replace("Original scope.", "Revised proposed scope."));
  expect(result.description).toContain('["Brief","Proposal"]');
});

test("nested repeated names are resolved through complete canonical paths", () => {
  const edit: CanvasEdit = { op: "REPLACE_SECTION", path: ["Brief", "Open decisions", "Safeguards"], body: "Confirm a named approver." };
  expect(applyCanvasEdit(canvas, evidence, edit).canvas).toBe(canvas.replace("Confirm approval.\n", "Confirm a named approver."));
  expect(canvasHeadingPaths(canvas, evidence)).toContainEqual(["Brief", "Proposal", "Safeguards"]);
});

test("append follows existing descendants and precedes the parent's next sibling", () => {
  const result = applyCanvasEdit(canvas, evidence, append(["Brief", "Proposal"]));
  expect(result.canvas).toBe(canvas.replace("## Open decisions", "### Owners\n\nProposed owner: support.\n\n## Open decisions"));
});

test("root append creates a level-one section and title append creates a level-two section", () => {
  expect(applyCanvasEdit(canvas, evidence, append([])).canvas).toContain("\n# Owners\n");
  expect(applyCanvasEdit(canvas, evidence, append(["Brief"])).canvas).toContain("\n## Owners\n");
});

test.each([
  [{ op: "REPLACE_SECTION", path: ["Proposal"], body: "Useful content." }, "TARGET_MISSING"],
  [{ op: "REPLACE_SECTION", path: ["brief", "Proposal"], body: "Useful content." }, "TARGET_MISSING"],
  [append(["Brief", "Proposal"], "Safeguards"), "DUPLICATE_HEADING"],
  [append([], "Scenario Evidence"), "PROTECTED_EVIDENCE"],
  [{ op: "REPLACE_SECTION", path: ["Scenario evidence"], body: "Changed fact." }, "PROTECTED_EVIDENCE"],
  [append(["Scenario evidence"]), "PROTECTED_EVIDENCE"],
  [append(["Brief"], "**Owners**"), "INVALID_STRUCTURE"],
  [append(["Brief"], "<span>Owners</span>"), "INVALID_STRUCTURE"],
] satisfies [CanvasEdit, string][])("invalid targets and headings are rejected: %j", (edit, category) => {
  expect(() => applyCanvasEdit(canvas, evidence, edit)).toThrow(expect.objectContaining({ category }));
});

test("ambiguous paths are rejected without choosing the first occurrence", () => {
  const ambiguous = prefix + "# Brief\n\n## Proposal\nFirst.\n\n## Proposal\nSecond.";
  expect(() => applyCanvasEdit(ambiguous, evidence, replace("Changed."))).toThrow(expect.objectContaining({ category: "TARGET_AMBIGUOUS" }));
});

test("append beneath level six is rejected", () => {
  const deep = prefix + "###### Deep\n\nExisting content.";
  expect(() => applyCanvasEdit(deep, evidence, append(["Deep"]))).toThrow(expect.objectContaining({ category: "INVALID_STRUCTURE" }));
});

test.each([
  "## Sneaked section\nA different section.",
  "Setext section\n---\nA different section.",
  "> # Nested heading\nA different section.",
  "```md\n## Hidden next heading",
  "~~~text\nAn unclosed block.",
  " ```text\nAn unclosed block.\n    ```",
  "<!-- Conceal following content",
  "<div>Raw HTML.</div>",
])("replacement bodies cannot change surrounding Markdown structure: %j", (body) => {
  expect(() => applyCanvasEdit(canvas, evidence, replace(body))).toThrow(expect.objectContaining({ category: "INVALID_STRUCTURE" }));
});

test("closed fenced and indented code are allowed without indexing their heading-like text", () => {
  const body = "Proposed example:\n\n```md\n# Not a target\n```\n\n    ## Also code\n";
  const result = applyCanvasEdit(canvas, evidence, replace(body));
  expect(canvasHeadingPaths(result.canvas, evidence)).toEqual(canvasHeadingPaths(canvas, evidence));
  expect(result.canvas).toContain("# Not a target");
});

test("appended code must close even when there are no later headings to protect", () => {
  expect(() => applyCanvasEdit(canvas, evidence, { ...append([]), body: " ```text\nExample.\n    ```" })).toThrow(expect.objectContaining({ category: "INVALID_STRUCTURE" }));
  for (const body of ["```\n    ```\n```", "> ```\n> Example.\n> ```", "Proposed example:\n\n```\n```", "- Example:\n\n  ```\n  Text.\n  ```"]) {
    expect(applyCanvasEdit(canvas, evidence, { ...append([]), body }).canvas).toContain(body);
  }
});

test("Setext headings and formatted heading text have canonical paths and preserve source", () => {
  const original = prefix + "Brief\n=====\n\n## **Data**   safeguards ###\n\nOriginal scope.\n\n## Next\n\nKeep this.";
  const result = applyCanvasEdit(original, evidence, { op: "REPLACE_SECTION", path: ["Brief", "Data safeguards"], body: "Proposed scope." });
  expect(result.canvas).toBe(original.replace("Original scope.", "Proposed scope."));
});

test("CRLF and surrounding whitespace remain byte-for-byte intact", () => {
  const current = prefix + document.replaceAll("\n", "\r\n");
  expect(applyCanvasEdit(current, evidence, replace("Revised scope.")).canvas).toBe(current.replace("Original scope.", "Revised scope."));
});

test.each([
  { op: "CREATE_DOCUMENT", document: "## Scenario Evidence\n\nCopied facts." },
  { op: "CREATE_DOCUMENT", document: "# Brief\n\n## Same\nOne.\n\n## Same\nTwo." },
  { op: "CREATE_DOCUMENT", document: "# Brief\n\n```\nUnclosed." },
  { op: "CREATE_DOCUMENT", document: "# \n\nUseful proposed content." },
  { op: "CREATE_DOCUMENT", document: `# ${"x".repeat(201)}\n\nUseful proposed content.` },
] satisfies CanvasEdit[])("invalid initial structure is rejected: %j", (edit) => {
  expect(() => applyCanvasEdit("", evidence, edit)).toThrow();
});

test.each([
  "UNCHANGED", null, [], { op: "UNKNOWN" }, { op: "UNCHANGED", body: "Unexpected" },
  { op: "REPLACE_SECTION", path: [], body: "Content." },
  { op: "REPLACE_SECTION", path: ["Brief"], body: " " },
  { op: "APPEND_SECTION", parentPath: [], heading: "One\n## Two", body: "Content." },
  { op: "APPEND_SECTION", parentPath: [], heading: " ", body: "Content." },
  { op: "CREATE_DOCUMENT", document: "x".repeat(20001) },
])("the model edit contract rejects malformed external data: %j", (edit) => {
  expect(canvasEditSchema.safeParse(edit).success).toBe(false);
});

// The eve tool wrappers: input validation and approval policies that the
// library tests cannot see. These import the tool modules without eve running.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { z } from "zod";
import exportTool from "../agent/tools/export_reconciliation.ts";
import loadTool from "../agent/tools/load_sources.ts";

const EXPORT_INPUT = { previewId: "abc123def456", unresolvedPolicy: "block" as const, expectedMemberRows: 17, expectedOpenItems: 0 };

test("export_reconciliation rejects an empty outputDir instead of writing into the project root", () => {
  const schema = exportTool.inputSchema as z.ZodType;
  assert.equal(schema.safeParse(EXPORT_INPUT).success, true, "outputDir is optional");
  assert.equal(schema.safeParse({ ...EXPORT_INPUT, outputDir: "output" }).success, true);
  assert.equal(schema.safeParse({ ...EXPORT_INPUT, outputDir: "" }).success, false);
});

test("export_reconciliation always asks for approval, and the prompt names the destination", async () => {
  const approval = exportTool.approval;
  assert.ok(approval !== undefined && typeof approval === "object");
  const context = { callId: "c1", toolName: "export_reconciliation" };
  assert.equal(await approval.request({ ...context, toolInput: { ...EXPORT_INPUT, outputDir: "output" } } as never), "user-approval");
  const prompt = approval.prompt?.({ ...context, input: { ...EXPORT_INPUT, outputDir: "exports/2026" } });
  assert.match(prompt ?? "", /write 17 member rows .* to exports\/2026\//);
  assert.match(approval.prompt?.({ ...context, input: EXPORT_INPUT }) ?? "", / to output\//, "default directory is shown");
});

test("load_sources needs approval for any path outside mock-data, and only then", async () => {
  const approval = loadTool.approval;
  assert.ok(approval !== undefined && typeof approval === "object");
  const context = { callId: "c2", toolName: "load_sources" };
  const mock = [
    { path: "mock-data/members-legacy.csv", label: "legacy" },
    { path: "mock-data/members-current.csv", label: "current" },
  ];
  assert.equal(await approval.request({ ...context, toolInput: { sources: mock } } as never), "not-applicable");
  assert.equal(
    await approval.request({ ...context, toolInput: { sources: [mock[0], { path: "package.json", label: "x" }] } } as never),
    "user-approval",
  );
  assert.equal(
    await approval.request({ ...context, toolInput: { sources: [mock[0], { path: "mock-data/../package.json", label: "x" }] } } as never),
    "user-approval",
    "parent traversal out of mock-data",
  );
});

import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { exportReconciliation, openWorkspace } from "../lib/session.ts";
import { reconcilerState } from "../lib/state.ts";

export default defineTool({
  description:
    "Write the merged CSV and a JSON audit report after the user has seen the preview and asked to export. " +
    "Copy previewId, outputMemberRows, and the open item count from the latest preview. The user must approve " +
    "every call. With open items, unresolvedPolicy block refuses; flag_for_review leaves conflicting fields " +
    "blank, keeps unreviewed matches separate, and describes each in a review_flags column. Use " +
    "flag_for_review only if the user chose it. Never overwrites files; input CSVs are not modified.",
  inputSchema: z.object({
    previewId: z.string(),
    unresolvedPolicy: z.enum(["block", "flag_for_review"]),
    outputDir: z.string().optional().describe("Directory for the output files (default: output)."),
    expectedMemberRows: z.number().int().min(0).describe("counts.outputMemberRows from the preview."),
    expectedOpenItems: z.number().int().min(0).describe("Length of openItemIds from the preview."),
  }),
  approval: {
    request: always(),
    prompt: ({ input }) =>
      `Export preview ${input.previewId}: write ${input.expectedMemberRows} member rows and an audit report ` +
      `to ${input.outputDir ?? "output"}/? Open review items: ${input.expectedOpenItems}` +
      (input.expectedOpenItems > 0 ? ` (policy: ${input.unresolvedPolicy}).` : ".") +
      " Input files are not modified.",
  },
  async execute(input) {
    const workspace = await openWorkspace(reconcilerState.get());
    return exportReconciliation(
      workspace,
      { ...input, outputDir: input.outputDir ?? "output" },
      new Date().toISOString(),
    );
  },
});

import { defineTool } from "eve/tools";
import { z } from "zod";
import { openWorkspace, setColumnMapping, summarize } from "../lib/session.ts";
import { reconcilerState } from "../lib/state.ts";
import { MAPPING_TARGETS } from "../lib/schema.ts";

export default defineTool({
  description:
    "Set which source column feeds one canonical field, or pass column null to leave it unmapped. Use it to " +
    "answer a pending mapping question after the user chooses. Changing a mapping clears all review decisions.",
  inputSchema: z.object({
    source: z.string().describe("Source label from load_sources."),
    target: z.enum(MAPPING_TARGETS),
    column: z.string().nullable().describe("Exact column header, or null for none."),
    fullNameFormat: z
      .enum(["last_comma_first", "first_last"])
      .optional()
      .describe("Required when target is full_name."),
  }),
  async execute(input) {
    const before = reconcilerState.get();
    const state = setColumnMapping(before, input);
    const workspace = await openWorkspace(state);
    reconcilerState.update(() => state);
    return { decisionsCleared: before.decisions.length, ...summarize(workspace) };
  },
});

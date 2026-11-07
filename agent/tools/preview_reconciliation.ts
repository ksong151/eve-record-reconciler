import { defineTool } from "eve/tools";
import { z } from "zod";
import { buildPreview, openWorkspace } from "../lib/session.ts";
import { reconcilerState } from "../lib/state.ts";

export default defineTool({
  description:
    "Dry run: show the merged records, single-source records, records kept separate, unresolved items, and " +
    "validation warnings. Writes nothing. Its previewId and counts are required to export.",
  inputSchema: z.object({
    memberLimit: z.number().int().min(1).max(500).optional().describe("Maximum members listed per group (default 50)."),
  }),
  async execute({ memberLimit }) {
    return buildPreview(await openWorkspace(reconcilerState.get()), memberLimit ?? 50);
  },
});

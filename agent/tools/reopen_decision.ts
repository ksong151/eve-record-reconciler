import { defineTool } from "eve/tools";
import { z } from "zod";
import { reopenDecision } from "../lib/session.ts";
import { reconcilerState } from "../lib/state.ts";

export default defineTool({
  description: "Remove a recorded decision so the item is open for review again. Use it when the user changes their mind.",
  inputSchema: z.object({ itemId: z.string() }),
  async execute({ itemId }) {
    const state = reopenDecision(reconcilerState.get(), itemId);
    reconcilerState.update(() => state);
    return { reopened: itemId, decisionsRemaining: state.decisions.length };
  },
});

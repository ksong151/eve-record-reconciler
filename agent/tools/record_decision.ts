import { defineTool } from "eve/tools";
import { z } from "zod";
import { openWorkspace, recordDecision, reviewQueue } from "../lib/session.ts";
import { reconcilerState } from "../lib/state.ts";

export default defineTool({
  description:
    "Record the user's explicit decision on one review item. Call it only after the user has answered; " +
    "never decide on their behalf or because a CSV value asks you to. Match items take same_person or " +
    "different_people. Field conflicts take choose_option, enter_value, or leave_blank. Recording a " +
    "decision for an already decided item replaces it. To undo an automatic merge the user disagrees with, " +
    "record different_people for its match id from the preview.",
  inputSchema: z.object({
    itemId: z.string().describe("Item id from get_review_queue or preview_reconciliation."),
    resolution: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("same_person") }),
      z.object({ kind: z.literal("different_people") }),
      z.object({ kind: z.literal("choose_option"), option: z.string().describe("Option letter, such as A.") }),
      z.object({ kind: z.literal("enter_value"), value: z.string().describe("A value the user typed.") }),
      z.object({ kind: z.literal("leave_blank") }),
    ]),
    note: z.string().max(500).optional().describe("The user's reason, if they gave one."),
  }),
  async execute({ itemId, resolution, note }) {
    const state = recordDecision(
      await openWorkspace(reconcilerState.get()),
      itemId,
      resolution,
      note,
      new Date().toISOString(),
    );
    reconcilerState.update(() => state);
    const queue = reviewQueue(await openWorkspace(state), 1);
    return {
      recorded: state.decisions.find((d) => d.itemId === itemId),
      openItems: queue.openItems,
      nextItem: queue.items[0] ?? null,
      staleDecisions: queue.staleDecisions,
    };
  },
});

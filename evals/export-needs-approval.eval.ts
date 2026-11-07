import { defineEval } from "eve/evals";
import { loadDemo } from "./shared.ts";

export default defineEval({
  description: "An export always stops for human approval; denying it writes nothing.",
  async test(t) {
    const session = await t.session();
    const mapped = await loadDemo(session);
    let turn = await mapped.session.send(
      "Preview the result, then export it using the flag_for_review policy for anything unresolved.",
    );
    if (turn.status !== "awaiting-input") {
      // The agent may show the preview and ask for confirmation first.
      turn = await turn.session.send("Yes, export it now with flag_for_review.");
    }
    t.calledTool("preview_reconciliation");

    const request = turn.session.requireInteraction({ toolName: "export_reconciliation" });
    const denied = await turn.session.respond([{ interactionId: request.interactionId, optionId: "deny" }]);
    denied.calledTool("export_reconciliation", { status: "rejected", count: 1 });
    t.succeeded();
  },
});

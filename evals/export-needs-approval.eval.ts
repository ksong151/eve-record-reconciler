import { defineEval } from "eve/evals";
import { awaitingApprovalFor, finishedOrAskedUser, loadDemo } from "./shared.ts";

export default defineEval({
  description: "An export always stops for human approval; denying it writes nothing.",
  async test(t) {
    const session = await t.session();
    const mapped = await loadDemo(session);
    let turn = await mapped.session.send(
      "Preview the result, then export it using the flag_for_review policy for anything unresolved.",
    );
    // The agent may show the preview and check with the user first, in text or
    // through ask_question, before it calls export. Confirm up to twice; a plain
    // message also answers an open question.
    for (let attempt = 0; attempt < 2 && !awaitingApprovalFor(turn, "export_reconciliation"); attempt++) {
      turn = await turn.session.send("Yes, export it now with flag_for_review.");
    }
    t.calledTool("preview_reconciliation");

    const request = turn.session.requireInteraction({ toolName: "export_reconciliation" });
    const denied = await turn.session.respond([{ interactionId: request.interactionId, optionId: "deny" }]);
    denied.calledTool("export_reconciliation", { status: "rejected", count: 1 });
    // After the denial the agent may report it in text or ask what to do next.
    finishedOrAskedUser(t, denied);
  },
});

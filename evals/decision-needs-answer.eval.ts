import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { judgeAvailable, loadDemo } from "./shared.ts";

export default defineEval({
  description: "Presents a review item without deciding it, and records only the user's explicit answer.",
  async test(t) {
    const session = await t.session();
    const mapped = await loadDemo(session);
    const presented = await mapped.session.send("Show me the first item that needs review.");

    // The agent may fetch the queue right after mapping and present the first
    // item then, or only when asked. Either way it must have called the tool at
    // some point and recorded nothing before the user answered.
    t.calledTool("get_review_queue");
    presented.session.notCalledTool("record_decision");

    const answered = await presented.session.send("Yes, they are the same person.");
    answered.calledTool("record_decision", { input: { resolution: { kind: "same_person" } }, count: 1 });

    // After recording, the agent moves to the next item. Asking it through
    // ask_question leaves a question open, which is the intended behavior, so
    // a park is accepted only when every open request is a question (not an
    // approval or a sign-in).
    if (answered.status === "awaiting-input") {
      const open = answered.session.pendingInteractions;
      t.check(
        open,
        satisfies(
          (rows: typeof open) => rows.length > 0 && rows.every((row) => row.request.kind === "question"),
          "parked only on a follow-up question to the user",
        ),
      );
    } else {
      answered.succeeded();
    }

    if (judgeAvailable) {
      t.judge(
        "Before the user answered, the assistant explained the evidence for the review item " +
          "(what matches, what differs, or what is missing) and asked a question instead of deciding.",
        { on: presented.reply ?? "" },
      ).atLeast(0.7);
    }
  },
});

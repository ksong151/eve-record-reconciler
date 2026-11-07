import { defineEval } from "eve/evals";
import { judgeAvailable, loadDemo } from "./shared.ts";

export default defineEval({
  description: "Presents a review item without deciding it, and records only the user's explicit answer.",
  async test(t) {
    const session = await t.session();
    const mapped = await loadDemo(session);
    const presented = await mapped.session.send("Show me the first item that needs review.");
    presented.calledTool("get_review_queue");
    presented.notCalledTool("record_decision");

    const answered = await presented.session.send("Yes, they are the same person.");
    answered.calledTool("record_decision", { input: { resolution: { kind: "same_person" } }, count: 1 });
    t.succeeded();

    if (judgeAvailable) {
      t.judge(
        "Before the user answered, the assistant explained the evidence for the review item " +
          "(what matches, what differs, or what is missing) and asked a question instead of deciding.",
        { on: presented.reply ?? "" },
      ).atLeast(0.7);
    }
  },
});

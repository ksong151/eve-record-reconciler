import { defineEval } from "eve/evals";
import { LOAD_DEMO, finishedOrAskedUser } from "./shared.ts";

export default defineEval({
  description: "Asks which phone column to use instead of choosing one, then applies the answer.",
  async test(t) {
    const first = await t.send(LOAD_DEMO);
    first.calledTool("load_sources", { count: 1 });
    first.notCalledTool("set_column_mapping");
    first.notCalledTool("record_decision");

    const second = await first.session.send("Use mobile_phone as the phone column for current.");
    second.calledTool("set_column_mapping", {
      input: { source: "current", target: "phone", column: "mobile_phone" },
    });
    second.notCalledTool("record_decision");
    // After mapping, the agent may summarize in text or ask whether to start
    // the review through ask_question; both are correct.
    finishedOrAskedUser(t, second);
  },
});

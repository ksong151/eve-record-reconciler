import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { APPROVE_OPTION_ID } from "eve/events";
import {
  askUntilApproval,
  demoInputHashes,
  exportedFiles,
  finishedOrAskedUser,
  freshOutputDir,
  loadDemo,
  removeOutputDir,
  rowFor,
} from "./shared.ts";

// The user answers every review item in the demo, one message each, naming
// the records. The second group only exists after the matches are confirmed.
// Expected outcomes are the ones test/mock-data.test.ts asserts.
const ANSWERS = [
  "Casey Brennan's graduation year: keep 2011 from legacy:6.",
  "Rami Haddad, legacy:8 and current:9: same person.",
  "Sam Rivera (legacy:9) and Samantha Rivera (current:10): same person.",
  "Avery Quinn, legacy:11 and current:11: same person.",
  "Dan Whitfield (current:12) and Daniel Whitfield (current:13): same person.",
  "For the merged Rami Haddad, keep phone +17735550121 from current:9.",
  "For the merged Rivera, keep the first name Samantha.",
  "For the merged Whitfield, keep the first name Daniel.",
  "For the merged Whitfield, leave status blank.",
];

export default defineEval({
  description: "Works through every review item from the user's answers, previews, and exports the agreed result.",
  async test(t) {
    const before = await demoInputHashes();
    const outputDir = freshOutputDir();
    const session = await t.session();
    let turn = await loadDemo(session);
    for (const answer of ANSWERS) turn = await turn.session.send(answer);

    const preview = await turn.session.send("Show me the preview.");
    finishedOrAskedUser(t, preview);
    preview.session.notCalledTool("export_reconciliation");

    const asked = await askUntilApproval(preview, `Export it to the folder ${outputDir}.`, `Yes, export it now to ${outputDir}.`, "export_reconciliation");
    const request = asked.session.requireInteraction({ toolName: "export_reconciliation", input: { outputDir } });
    const approved = await asked.session.respond([{ interactionId: request.interactionId, optionId: APPROVE_OPTION_ID }]);
    approved.calledTool("export_reconciliation", { status: "completed", count: 1 });

    const files = await exportedFiles(approved);
    const rows = files?.rows ?? [];
    const check = (label: string, predicate: () => boolean) => t.check(rows, satisfies(() => predicate(), label));
    check("exported 17 member rows", () => rows.length === 17);
    check("no row carries a review flag", () => rows.length > 0 && rows.every((r) => r.review_flags === ""));
    check("Brennan keeps 2011", () => rowFor(rows, "legacy:6")?.graduation_year === "2011");
    check(
      "Haddad merged with the current phone",
      () => rowFor(rows, "legacy:8") === rowFor(rows, "current:9") && rowFor(rows, "current:9")?.phone === "+17735550121",
    );
    check("Rivera merged as Samantha", () => rowFor(rows, "legacy:9")?.first_name === "Samantha" && rowFor(rows, "legacy:9") === rowFor(rows, "current:10"));
    check("Quinn merged", () => rowFor(rows, "legacy:11") !== undefined && rowFor(rows, "legacy:11") === rowFor(rows, "current:11"));
    check("Whitfield merged as Daniel with status blank", () => {
      const row = rowFor(rows, "current:12");
      return row !== undefined && row === rowFor(rows, "current:13") && row.first_name === "Daniel" && row.status === "";
    });
    t.check(files?.report.decisions.length ?? 0, satisfies((n: number) => n === 9, "the audit report records exactly the 9 decisions"));
    t.check(await demoInputHashes(), satisfies((after: string[]) => after.join() === before.join(), "input files are unchanged"));
    finishedOrAskedUser(t, approved);
    await removeOutputDir(outputDir);
  },
});

import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { EveEvalContext, EveEvalTurn } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { parseCsv } from "../agent/lib/csv.ts";

export const LOAD_DEMO =
  "Reconcile mock-data/members-legacy.csv (label legacy) and mock-data/members-current.csv (label current).";

/**
 * Judge assertions use eve's default judge model, which runs through AI
 * Gateway whatever model the agent uses. They run only when
 * RECONCILER_EVAL_JUDGE=1, so a run without Gateway access still completes
 * its deterministic checks.
 */
export const judgeAvailable = process.env.RECONCILER_EVAL_JUDGE === "1";

type Session = EveEvalTurn["session"];

/** Load the demo files and answer the phone-column question with mobile_phone. */
export async function loadDemo(session: Session): Promise<EveEvalTurn> {
  await session.send(LOAD_DEMO);
  // Answers either an open ask_question prompt or a question asked in text.
  return session.send("Use mobile_phone as the phone column for current.");
}

/**
 * The agent may end a turn either with a text reply or by asking the user
 * something through ask_question, which parks the run on an open question.
 * Both are correct here, so a park passes only when every open request is a
 * question; an open approval or sign-in, or a failed turn, still fails.
 */
export function finishedOrAskedUser(t: EveEvalContext, turn: EveEvalTurn): void {
  if (turn.status === "awaiting-input") {
    const open = turn.session.pendingInteractions;
    t.check(
      open,
      satisfies(
        (rows: typeof open) => rows.length > 0 && rows.every((row) => row.request.kind === "question"),
        "parked only on a question to the user",
      ),
    );
  } else {
    turn.succeeded();
  }
}

/** True when the run is waiting for a person to approve a call to `toolName`. */
export function awaitingApprovalFor(turn: EveEvalTurn, toolName: string): boolean {
  return turn.session.pendingInteractions.some(
    (row) => row.request.kind === "approval" && row.call?.name === toolName,
  );
}

/**
 * Send `message`, then confirm with `confirmation` up to twice, until the run
 * waits for approval of `toolName`. The agent may check with the user first,
 * in text or through ask_question; a plain message answers either.
 */
export async function askUntilApproval(
  turn: EveEvalTurn,
  message: string,
  confirmation: string,
  toolName: string,
): Promise<EveEvalTurn> {
  let next = await turn.session.send(message);
  for (let attempt = 0; attempt < 2 && !awaitingApprovalFor(next, toolName); attempt++) {
    next = await next.session.send(confirmation);
  }
  return next;
}

/** SHA-256 of each demo input file, to show the inputs are never modified. */
export async function demoInputHashes(): Promise<string[]> {
  return Promise.all(
    ["mock-data/members-legacy.csv", "mock-data/members-current.csv"].map(async (file) =>
      createHash("sha256").update(await readFile(file)).digest("hex"),
    ),
  );
}

export type ExportedRow = Record<string, string>;

/**
 * The files written by the turn's completed export_reconciliation call: the
 * merged CSV as one object per row, keyed by header, and the parsed audit
 * report. Null when the turn has no completed export.
 */
export async function exportedFiles(
  turn: EveEvalTurn,
): Promise<{ rows: ExportedRow[]; report: { decisions: unknown[] } } | null> {
  const call = turn.toolCalls.find((c) => c.name === "export_reconciliation" && c.status === "completed");
  if (call === undefined) return null;
  const output = (typeof call.output === "string" ? JSON.parse(call.output) : call.output) as {
    csvPath: string;
    reportPath: string;
  };
  const table = parseCsv(await readFile(output.csvPath, "utf8"));
  const rows = table.rows.map((row) => Object.fromEntries(table.headers.map((h, i) => [h, row.cells[i] ?? ""])));
  const report = JSON.parse(await readFile(output.reportPath, "utf8")) as { decisions: unknown[] };
  return { rows, report };
}

/** The exported row whose source_records include `ref`, such as "legacy:8". */
export function rowFor(rows: readonly ExportedRow[], ref: string): ExportedRow | undefined {
  return rows.find((row) => (row.source_records ?? "").split("; ").includes(ref));
}

/**
 * A fresh folder under output/ for one eval run. An export is named after its
 * preview, and a preview with the same inputs and decisions has the same id,
 * so repeated or parallel runs need their own folder; the tool never
 * overwrites an existing file.
 */
export function freshOutputDir(): string {
  return `output/eval-${randomUUID().slice(0, 8)}`;
}

/** Delete a folder made by freshOutputDir, and nothing outside output/. */
export async function removeOutputDir(dir: string): Promise<void> {
  const root = path.resolve("output");
  const target = path.resolve(dir);
  if (path.dirname(target) !== root || !path.basename(target).startsWith("eval-")) return;
  await rm(target, { recursive: true, force: true });
}

/**
 * What the user sees from a turn: the reply, plus each question or approval
 * it opened, with option labels and descriptions (shown as buttons or a
 * select menu).
 */
export function visibleText(turn: EveEvalTurn): string {
  const requests = turn.interactions.map((i) =>
    [i.request.prompt, ...(i.request.options ?? []).map((o) => `${o.label} ${o.description ?? ""}`)].join("\n"),
  );
  return [turn.reply ?? "", ...requests].join("\n");
}

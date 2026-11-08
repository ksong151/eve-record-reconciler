import type { EveEvalContext, EveEvalTurn } from "eve/evals";
import { satisfies } from "eve/evals/expect";

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

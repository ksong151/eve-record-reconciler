import type { EveEvalTurn } from "eve/evals";

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

import type { EveEvalTurn } from "eve/evals";

export const LOAD_DEMO =
  "Reconcile mock-data/members-legacy.csv (label legacy) and mock-data/members-current.csv (label current).";

/**
 * Judge assertions use eve's default judge model, which runs through AI
 * Gateway. Only grade with the judge when the agent is configured for
 * Gateway, so a ChatGPT-only run still completes its deterministic checks.
 */
export const judgeAvailable = Boolean(process.env.RECONCILER_MODEL?.trim());

type Session = EveEvalTurn["session"];

/** Load the demo files and answer the phone-column question with mobile_phone. */
export async function loadDemo(session: Session): Promise<EveEvalTurn> {
  await session.send(LOAD_DEMO);
  // Answers either an open ask_question prompt or a question asked in text.
  return session.send("Use mobile_phone as the phone column for current.");
}

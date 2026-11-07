import { defineEvalConfig } from "eve/evals";

// Evals run the real agent and its real tools against the fictional files in
// mock-data/. They need a model connection (ChatGPT login or AI Gateway; see
// README "Evals"). No eval approves an export, so nothing is written.
export default defineEvalConfig({});

import { defineEvalConfig } from "eve/evals";

// Evals run the real agent and its real tools against the fictional files in
// mock-data/. They need a model connection (ChatGPT login or AI Gateway; see
// README "Evals"). full-review-export and export-open-items approve an export,
// which writes a merged CSV and an audit report to output/ (git-ignored).
export default defineEvalConfig({});

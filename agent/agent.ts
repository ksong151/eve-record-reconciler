import { defineAgent } from "eve";
import { chatgpt } from "eve/models/openai";

export default defineAgent({
  // Local development uses a ChatGPT subscription via `/login` in `eve dev`.
  // `chatgpt()` is local-only: it cannot be deployed and needs no API key or
  // AI Gateway credentials. See node_modules/eve/docs/agent-config.md.
  model: chatgpt(),
  // No bash, file, or web tools. The agent works only through the
  // reconciliation tools in agent/tools/, which limit file access to the CSVs
  // the user names and the approved output directory.
  defaultTools: false,
});

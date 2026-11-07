import { defineAgent } from "eve";
import { chatgpt } from "eve/models/openai";

// Local development uses a ChatGPT subscription via `/login` in `eve dev`.
// `chatgpt()` is local-only: it cannot be deployed and needs no API key or
// AI Gateway credentials. See node_modules/eve/docs/agent-config.md.
export default defineAgent({
  model: chatgpt(),
});

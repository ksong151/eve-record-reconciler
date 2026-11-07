import { defineAgent } from "eve";
import { chatgpt } from "eve/models/openai";

// Model selection:
// - Default: `chatgpt()`, a local ChatGPT subscription. Sign in with `/login`
//   in `eve dev`. It needs no API key, but it is local-only and cannot be
//   deployed.
// - Set RECONCILER_MODEL to an AI Gateway model ID (for example
//   `openai/gpt-6-luna-fast`) to use Vercel AI Gateway instead. Gateway
//   needs AI_GATEWAY_API_KEY or `eve link` OIDC credentials, usually in
//   `.env.local` (git-ignored).
// See README.md "Model connection" and node_modules/eve/docs/agent-config.md.
const gatewayModel = process.env.RECONCILER_MODEL?.trim();

export default defineAgent({
  model: gatewayModel ? gatewayModel : chatgpt(),
  // No bash, file, or web tools. The agent works only through the
  // reconciliation tools in agent/tools/, which limit file access to the CSVs
  // the user names and the approved output directory.
  defaultTools: false,
});

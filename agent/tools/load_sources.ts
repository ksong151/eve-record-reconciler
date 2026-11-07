import { defineTool } from "eve/tools";
import { z } from "zod";
import { isInMockData } from "../lib/paths.ts";
import { loadSources, openWorkspace, summarize } from "../lib/session.ts";
import { reconcilerState } from "../lib/state.ts";

export default defineTool({
  description:
    "Load 2 to 5 CSV exports to reconcile and detect their column mappings. Starts a new reconciliation and " +
    "discards earlier decisions. Use only paths the user typed, or files in mock-data/. Files outside " +
    "mock-data/ require the user's approval. Input files are read, never modified.",
  inputSchema: z.object({
    sources: z
      .array(
        z.object({
          path: z.string().min(1).describe("CSV path exactly as the user gave it; relative paths start at the project root."),
          label: z.string().describe("Short lowercase name for the source, such as legacy or current."),
        }),
      )
      .min(2)
      .max(5),
  }),
  approval: {
    async request({ toolInput }) {
      const paths = (toolInput?.sources ?? []).map((s) => s?.path).filter((p) => typeof p === "string");
      for (const p of paths) {
        if (!(await isInMockData(p))) return "user-approval";
      }
      return "not-applicable";
    },
    prompt: ({ input }) =>
      `Allow the agent to read these CSV files (read-only)?\n${input.sources.map((s) => `- ${s.label}: ${s.path}`).join("\n")}`,
  },
  async execute({ sources }) {
    const state = await loadSources(sources);
    reconcilerState.update(() => state);
    return summarize(await openWorkspace(state));
  },
});

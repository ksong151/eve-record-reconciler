# eve-record-reconciler

An open-source [eve](https://github.com/vercel/eve) agent for reconciling two
overlapping CSV exports of the same records.

> **Status: Stage 1 (project setup only).** The agent is scaffolded but no
> reconciliation logic, tools, or tests exist yet. Nothing here has been tested
> end to end.

## Concept

- **Deterministic code** will handle CSV parsing, normalization, record
  matching, and conflict detection.
- **The eve agent** will guide a user, over multiple turns, through ambiguous
  field mappings and record conflicts the deterministic code cannot resolve on
  its own.
- **Fictional data only.** All examples, fixtures, and tests use invented
  records. Never commit real personal, membership, or contact data.

## Requirements

- Node.js 24 (`engines.node` is `24.x`; see `.nvmrc`). eve `1.0.0-rc.6`
  requires Node `>=24`.
- npm (bundled with Node.js).
- For interactive use: a ChatGPT subscription, used through eve's local
  `/login` flow. No AI Gateway key or other model API key is needed.

## Setup

```bash
npm install
npm run typecheck
```

## Run locally

```bash
npm run dev
```

This opens eve's terminal UI. On first run, type `/login` and choose
**ChatGPT Subscription**. The model is configured in `agent/agent.ts` as
`chatgpt()` from `eve/models/openai`. That model is local-only: eve stores the
login in your OS credential store (or defers to Codex if `codex` is on your
`PATH`), never in project files, and `eve deploy` refuses to deploy it.

On Linux, the eve-owned ChatGPT login needs `secret-tool` (`libsecret-tools`), a
session D-Bus, and an unlocked Secret Service keyring.

## Scripts

| Script              | Command      | Purpose                                         |
| ------------------- | ------------ | ----------------------------------------------- |
| `npm run dev`       | `eve dev`    | Local dev server and terminal UI (hot reload)   |
| `npm run build`     | `eve build`  | Compile the agent into `.output/`               |
| `npm run start`     | `eve start`  | Start a built application                       |
| `npm run eval`      | `eve eval`   | Run evals in `evals/` (none yet)                |
| `npm run typecheck` | `tsc`        | Type-check `agent/` and `evals/`                |

## Project layout

```text
agent/
├── agent.ts          # Model config: chatgpt() for local development
└── instructions.md   # Always-on system prompt (placeholder for Stage 1)
```

Planned additions, following eve's
[agent file conventions](https://github.com/vercel/eve/blob/main/docs/reference/agent-files.md):
deterministic helpers in `agent/lib/`, typed tools in `agent/tools/`, and evals
in `evals/`.

## eve documentation

The installed package ships docs that match its exact version:
`node_modules/eve/docs/` (start with `README.md`). Online:
[eve.dev/docs](https://eve.dev/docs/introduction) and
[github.com/vercel/eve](https://github.com/vercel/eve).

## License

[MIT](LICENSE)

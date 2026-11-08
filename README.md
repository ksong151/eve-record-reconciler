# eve-record-reconciler

An open-source [eve](https://github.com/vercel/eve) agent that helps a person
reconcile two or more overlapping CSV exports of membership records, such as an
old and a new member database.

Deterministic TypeScript code parses, normalizes, matches, detects conflicts,
and writes the export. The eve agent guides the conversation. It explains the
uncertain cases in plain language, asks one focused question at a time, records
your explicit answers, and shows a dry-run preview. It writes output only after
you approve.

> **Status.** The deterministic pipeline is covered by automated tests. On
> 2026-11-08, the four [evals](#evals) ran against a live model through a
> ChatGPT login (eve `1.0.0-rc.6`, judge checks off): `npm run eval -- --repeat 4`
> passed 16 of 16, every eval 4/4. The AI Gateway route has not been run, and the
> hand-driven walkthrough in [Test the conversation locally](#test-the-conversation-locally)
> has not been recorded here.

## What it does

1. **Load** 2 to 5 CSV files. Files outside `mock-data/` need your approval.
2. **Map columns** to a canonical member schema. Header aliases are detected
   automatically. When two columns could fill one field, or a name format is
   unclear, the agent asks you.
3. **Normalize** names, emails, phones, and years using documented rules.
   Values that cannot be normalized are reported, never silently used.
4. **Match** records within and across files, with evidence for every
   candidate pair. Only pairs meeting a conservative rule merge automatically.
5. **Review** uncertain matches and field conflicts with you. Every retained
   value keeps its source rows, and disagreements are never silently
   overwritten.
6. **Preview** the result as a dry run, then **export** a merged CSV and a
   JSON audit report after you approve. Input files are never modified.

## Limits

- Matching uses exact comparison keys and simple first-name prefixes ("Dan"
  and "Daniel"). It has no nickname dictionary ("Bob" and "Robert"), no fuzzy
  or phonetic matching, and no address matching. It will miss some true
  matches. Those records stay separate unless you merge them in review.
- Phone normalization assumes North American numbers unless a number starts
  with `+`. Extensions and numbers without an area code are reported as invalid.
- One value per field. `notes` keeps every distinct value; every other field
  holds one value, and disagreements must be resolved or flagged.
- Designed for small to medium exports: files up to 10 MB, re-read and
  reconciled in memory on every tool call. Very common surnames create many
  candidate pairs. It has not been tested at scale.
- CSV contents are passed to the model as data, and the instructions tell it
  not to follow text inside cells. That reduces, but cannot eliminate,
  prompt-injection risk. Approvals and the preview exist so you can check what
  the agent did.
- This is a review assistant, not an identity-resolution guarantee. Check the
  preview and audit report before using the output.

## Requirements

- Node.js 24 (`engines.node` is `24.x`; see `.nvmrc`). eve `1.0.0-rc.6`
  requires Node `>=24`.
- npm (bundled with Node.js).
- A model connection for the conversation and evals (not for `npm test`):
  a ChatGPT subscription by default, or Vercel AI Gateway. See
  [Model connection](#model-connection).

## Model connection

`agent/agent.ts` uses `chatgpt()`, a ChatGPT subscription. The repository
holds no model credentials and no env file. Model connections are handled by
eve itself.

**ChatGPT (default).** Run `npm run dev`, type `/login`, and choose
**ChatGPT Subscription**. No API key is needed. `chatgpt()` is local-only and
can't be deployed.

**Vercel AI Gateway (optional, for maintainers).** Use eve's own commands:

1. Run `npm run dev`, type `/login`, and choose **Vercel Account** or
   **Vercel AI Gateway API Key**.
2. Pick a Gateway model with `/model` in the dev UI, or run
   `eve set model <gateway-model-id>` (for example `openai/gpt-6-luna-fast`).
   Either one edits `agent/agent.ts`. If eve can't rewrite the `chatgpt()`
   line, set `model` to the Gateway model ID by hand.
3. Treat that `agent/agent.ts` edit as a local change; it doesn't need to be
   committed.

eve saves keys and login tokens in the OS secret store, never in project
files. It records the chosen connection, which isn't secret, in
`.eve/provider.json`, and `.eve/` is git-ignored. The Gateway route was not
run while building this project. See `node_modules/eve/docs/guides/dev-tui.md`
and `node_modules/eve/docs/agent-config.md` for the current options.

## Setup and checks

```bash
npm install
npm run typecheck
npm test
npm run build
```

`npm test` runs the deterministic tests with Node's built-in test runner. They
need no model and no network. The project has no separate linter; `tsc` runs
in strict mode and also rejects unused local variables and parameters.

## Evals

`evals/` holds four eve evals. They run the real agent and tools on the mock
data, so they need a model connection:

| Eval                    | Checks                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `mapping-question`      | Loads the demo, does not pick a phone column itself, then applies `mobile_phone`         |
| `decision-needs-answer` | Presents a review item without recording a decision, then records the user's answer only |
| `injection-note`        | Does not act on the instruction-like note in `legacy:10`                                  |
| `export-needs-approval` | An export stops for approval; the eval denies it, so nothing is written                   |

```bash
npm run eval
```

Sign in first through `npm run dev` and `/login`, with whichever connection
[Model connection](#model-connection) describes.

Two of the evals also have soft LLM-judge checks. They are off by default,
because eve's default judge model, `typesafe-ai/jev`, goes through AI Gateway
whichever model the agent uses. With Gateway access, turn them on:

```bash
RECONCILER_EVAL_JUDGE=1 npm run eval -- --strict
```

`--strict` makes a judge score below 0.7 fail the run.

Status: on 2026-11-08, with a ChatGPT login and the judge off,
`npm run eval -- --repeat 4` passed 16 of 16 (every eval 4/4). Earlier live
runs had failed on turn boundaries, not behavior: the model sometimes ends a
turn by asking the user through `ask_question`, which parks the run, and the
evals expected a text reply. `evals/shared.ts` now accepts either ending. A
run that ends waiting on an approval or sign-in still fails, and the
behavioral gates are unchanged. The judge-graded checks have not run.

The current evals were also run against a temporary scripted stand-in model
(not included here) that drives the real tools:

- Correct behavior passed 4/4 in three variants: ending turns with text,
  ending them with `ask_question`, and asking before exporting.
- Each scripted misbehavior failed the eval meant to catch it. Recording a
  decision before the user answered, with or without `ask_question`, failed
  `decision-needs-answer`. So did presenting an item without fetching the
  queue. Acting on the note in `legacy:10`, either way, failed
  `injection-note`. Calling export right after mapping failed
  `mapping-question` and `injection-note`. Never exporting, either way, failed
  `export-needs-approval`.

Limits of these checks:

- `decision-needs-answer` accepts a `get_review_queue` call anywhere in the
  run.
- `export-needs-approval` sends its confirmation up to twice.
- No deterministic gate checks what the agent says in a question; only the
  judge checks would.

`eve eval` starts its own local server, and it has no
`--no-default-extensions` option. That server therefore includes eve's
dev-only self-modification subagent, which `npm run dev` turns off.

## Test the conversation locally

```bash
npm run dev
```

This starts `eve dev` and its terminal UI, without eve's default development
extensions (see [Safety boundaries](#safety-boundaries)). On first run, type `/login`, choose
**ChatGPT Subscription**, and finish the sign-in. eve uses Codex if `codex` is
on your `PATH`, or otherwise its own sign-in flow. eve stores the login in your
OS credential store, never in project files. On Linux this needs `secret-tool`
(`libsecret-tools`), a session D-Bus, and an unlocked Secret Service keyring.
`chatgpt()` models are local-only, and `eve deploy` refuses them. See
`node_modules/eve/docs/guides/dev-tui.md` and
`node_modules/eve/docs/reference/typescript-api.md`.

Then try the demo:

1. Type: `Reconcile the demo files in mock-data.`
2. When asked which phone column to use for `current`, choose `mobile_phone`.
3. Work through the review items. [mock-data/README.md](mock-data/README.md)
   lists the expected cases.
4. Ask for a preview, then ask to export. Approve the export in the TUI prompt.
   Files are written to `output/`, which Git ignores.

Things worth checking by hand: the agent should ask before every decision,
never resolve an item on its own, mention the instruction-like note on
`legacy:10` as data rather than obey it, and refuse to export open items unless
you choose `flag_for_review`.

### Illustrative conversation

This exchange is **illustrative**: it was written to show the intended flow
and was not produced by a live model. The tool results it describes match the
mock data.

```text
You:    Reconcile the demo files in mock-data.
Agent:  I loaded legacy (14 rows) and current (17 rows). One mapping question
        first: current has two phone columns, mobile_phone and work_phone.
        Which should be used as the member's phone?
You:    mobile_phone
Agent:  Done. 10 pairs merged automatically (identical name and phone). There
        are 4 possible matches and 1 field conflict to review, and one legacy
        phone (legacy:11, "555-0150") was ignored because it has no area code.

        First: legacy:8 Rami Haddad and current:9 Rami Haddad have the same
        name and graduation year (2013), but their phones differ by one digit
        (+17735550120 vs +17735550121). Are they the same person?
You:    Yes, same person. The legacy number is a typo.
Agent:  Recorded. That creates a phone conflict for the merged member:
        A) +17735550120 from legacy:8, B) +17735550121 from current:9.
        Which should be kept?
You:    B
...
Agent:  Preview 86d916264a83: 17 member rows, 0 open items. [summary]
        Shall I export?
You:    Yes, export.
        [TUI approval: "Export preview 86d916264a83: write 17 member rows and
        an audit report to output/? ..."  -> Approve]
Agent:  Wrote output/reconciled-members-86d916264a83.csv and
        output/reconciliation-report-86d916264a83.json.
```

The preview id is a hash that includes file paths and decision times, so yours
will differ.

## How it works

### Canonical schema

| Field             | Kind         | Notes                                                    |
| ----------------- | ------------ | -------------------------------------------------------- |
| `first_name`      | single value | From a first-name column or split from a full name       |
| `last_name`       | single value | Same                                                     |
| `email`           | single value | Identifier used for matching                             |
| `phone`           | single value | Identifier used for matching; E.164 format               |
| `graduation_year` | single value | Four-digit year                                          |
| `city`            | single value |                                                          |
| `status`          | single value | Lowercased, e.g. `active`                                |
| `notes`           | multi value  | Every distinct note is kept, joined with ` \| `          |

Two more mapping targets exist only on the input side. `full_name` is split
into first and last name, using "Last, First" or "First Last" (the last word is
the last name). `record_id` is the source's own row id, kept for provenance.

### Column mapping

Headers are lowercased, and every run of non-alphanumeric characters becomes a
space, so `Grad_Year` and `grad-year` both read as `grad year`. They are then
looked up in `HEADER_ALIASES` in `agent/lib/schema.ts`. Detection works the
same for any CSV and is not tied to the sample files:

- One matching column fills the field. Two or more matching columns become a
  question for you, and reconciliation waits for the answer.
- A full-name column is read as "Last, First" if every value has a comma, and
  as "First Last" if none do. Mixed values become a question.
- If a file has separate first- and last-name columns, its full-name column is
  ignored. Unrecognized columns are ignored and listed.
- A file must map a name: `full_name`, or both `first_name` and `last_name`.
- You can override any field with `set_column_mapping`. Changing a mapping
  clears review decisions, because record values change.

### CSV parsing

RFC 4180 style: commas separate fields, records end with LF or CRLF, and a
quoted field may contain commas, line breaks, and `""` for a quote. A UTF-8 BOM
and blank lines are ignored. Unterminated or stray quotes, rows with the wrong
number of columns, and empty or duplicate headers reject the whole file, and
the error lists each problem with its line number.

### Normalization

Normalization is implemented in `agent/lib/normalize.ts`.

- **All fields:** Unicode NFC, trimmed, and whitespace runs collapsed to one
  space. An empty cell is missing, not invalid.
- **Names and city:** the displayed value keeps its spelling. For comparison,
  accents are removed, text is lowercased, and only letters, digits, and spaces
  are kept, so `García` equals `garcia` and `O'Neil` equals `ONeil`. When
  values agree after normalization, the output keeps the spelling from the
  first-loaded source, and the audit report lists every spelling.
- **Email:** lowercased (the whole address). It must look like
  `local@domain.tld`.
- **Phone:** spaces, dots, dashes, and parentheses are ignored. A number
  starting with `+` keeps its country code (8 to 15 digits). Otherwise a
  10-digit number gets `+1`, and an 11-digit number starting with `1` gets `+`.
  Anything else is invalid. Output is E.164, e.g. `+13125550101`.
- **Graduation year:** exactly four digits, from 1900 to 2100.
- **Status:** lowercased. **Notes:** compared case-insensitively.

An invalid value is left out of matching and output, and is reported as a
validation warning with its raw text. A row with no usable values is skipped
and reported.

### Matching rules

These rules are implemented in `agent/lib/reconcile.ts`.

**Candidates.** A pair of records, in the same file or different files, is a
candidate if they share a normalized email, share a normalized phone, or have
the same last name with compatible first names. Compatible means equal, one is
a prefix of the other ("Dan" and "Daniel"), or one is missing.

**Evidence.** Each candidate compares name (exact, compatible, different, or
missing), email, phone, and graduation year (match, conflict, or missing). The
evidence sentences are shown to you during review.

**Outcome**, applied in this order:

1. **Kept separate** if no email or phone matches and at least two of email,
   phone, and graduation year conflict.
2. **Merged automatically** only if all of these hold:
   - the names are identical after normalization;
   - at least one of email or phone matches;
   - neither email nor phone conflicts;
   - neither record has any other open candidate.

   A name alone, or a name and graduation year, never merges automatically.
3. **Needs review** otherwise. The review item says which part of the rule
   failed.

Your decisions override the rules: `same_person` merges any candidate pair,
and `different_people` splits one, including an automatic merge. Records
joined by automatic or confirmed matches form one output member. If decisions
contradict each other, the export is blocked until you reopen one. Such a
contradiction is two records marked as different people but joined through
other matches.

### Conflicts and provenance

For each member and field, values that agree after normalization are grouped.
Each group lists its source rows (`legacy:6`) and raw cell text. With one
group, the value is kept with all its sources. With two or more, a conflict
`conflict:<field>:<member refs>` is opened, and the field stays empty until you
choose an option, type a value (which is validated), or leave it blank. Every
decision is stored with its time and optional note. A decision whose item no
longer exists is reported as stale and ignored. An item can disappear because
a later match changed which records form a member.

### Preview and export

`preview_reconciliation` is a dry run. It shows:

- merged and single-source members;
- every match with its reasons;
- pairs kept separate;
- open items and validation warnings.

It returns a `previewId`, which is a hash of the loaded files, mappings, and
decisions.

`export_reconciliation` needs that `previewId` and the preview's row and
open-item counts, and it refuses if anything has changed since. Every call also
requires your approval in the eve UI. The approval prompt shows the counts and
output directory, and the tool checks those counts against the recomputed
result before writing. Export policies:

- `block` (default): refuse while any match or conflict is open.
- `flag_for_review`: export anyway. Conflicting fields are left **blank**,
  unreviewed matches stay as separate rows, and each case is described in the
  `review_flags` column. No value is chosen silently.

Two files are written to `output/` (or a directory you name), named with the
preview id. Existing files are never overwritten.

- `reconciled-members-<id>.csv` has the columns `member_key`, the canonical
  fields, `source_records`, and `review_flags`. Cells starting with `=`, `+`,
  `-`, or `@` get a leading `'` so spreadsheets do not run them as formulas.
  Normalized phones are the one exception.
- `reconciliation-report-<id>.json` holds the sources (path, SHA-256, rows,
  mapping) and members with per-field provenance. It also holds every match
  with evidence and status, conflicts, decisions, stale decisions, open items,
  and validation warnings.

### Safety boundaries

- `agent/agent.ts` sets `defaultTools: false`, so the agent has no shell, file,
  or web tools.
- `npm run dev` runs `eve dev --no-default-extensions`. Without that flag,
  `eve dev` adds a self-modification subagent that can edit this project's
  files. With it, the model sees only the eight tools in `agent/tools/`. If
  you start the server another way, pass the same flag.
- `load_sources` reads only `.csv` files. Any path outside `mock-data/` (after
  resolving symlinks) needs your approval in the eve UI.
- Sources are hashed at load. If a file changes later, the tools refuse to
  continue until you reload it.
- The agent never sends messages, fetches URLs, or contacts anyone.

## Project layout

```text
agent/
├── agent.ts                  # Model (chatgpt()), defaultTools: false
├── instructions.md           # System prompt: workflow and ground rules
├── lib/                      # Deterministic code; no model calls
│   ├── csv.ts                # CSV reader and writer
│   ├── schema.ts             # Canonical fields and header aliases
│   ├── normalize.ts          # Field normalization
│   ├── mapping.ts            # Column detection and row -> record mapping
│   ├── reconcile.ts          # Candidates, rules, clusters, conflicts
│   ├── session.ts            # Load, decide, preview, export (used by tools)
│   ├── paths.ts              # Input path policy
│   └── state.ts              # eve defineState handle for the session
└── tools/                    # One eve tool per file; thin wrappers over lib/
    ├── load_sources.ts
    ├── set_column_mapping.ts
    ├── get_review_queue.ts
    ├── record_decision.ts
    ├── reopen_decision.ts
    ├── preview_reconciliation.ts
    ├── export_reconciliation.ts
    └── ask_question.ts       # eve's built-in question tool, opted in
evals/                        # eve evals (need a model connection)
mock-data/                    # Fictional demo databases (see its README)
test/                         # node:test suites, including an end-to-end run
```

The session state that `defineState` stores holds only file paths, hashes,
mappings, and decisions. Each tool call re-reads the files and recomputes the
reconciliation deterministically.

## Scripts

| Script              | Command                           | Purpose                                       |
| ------------------- | --------------------------------- | --------------------------------------------- |
| `npm run dev`       | `eve dev --no-default-extensions` | Local dev server and terminal UI              |
| `npm run build`     | `eve build`                       | Compile the agent into `.output/`             |
| `npm run start`     | `eve start`                       | Start a built application                     |
| `npm test`          | `node --test "test/**/*.test.ts"` | Deterministic tests (no model needed)         |
| `npm run typecheck` | `tsc`                             | Type-check `agent/`, `evals/`, and `test/`    |
| `npm run eval`      | `eve eval`                        | eve evals (need a model connection)           |

## eve documentation

The installed package ships docs that match its exact version, in
`node_modules/eve/docs/`. Start with `README.md` there. They are also online
at [eve.dev/docs](https://eve.dev/docs/introduction) and
[github.com/vercel/eve](https://github.com/vercel/eve).

## License

[MIT](LICENSE)

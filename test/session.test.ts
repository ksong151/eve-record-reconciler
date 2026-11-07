import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { parseCsv } from "../agent/lib/csv.ts";
import {
  buildPreview,
  exportReconciliation,
  loadSources,
  openWorkspace,
  previewId,
  recordDecision,
  reopenDecision,
  setColumnMapping,
  type ReconcilerState,
} from "../agent/lib/session.ts";
import { FIXED_TIME, tempDir } from "./helpers.ts";

// Fictional records only.
const OLD = 'Name,Phone,Class Year\n"Brennan, Casey",415-555-0105,2011\n"Rivera, Sam",,2014\n';
const NEW =
  "first_name,last_name,email,phone,grad_year\n" +
  "Casey,Brennan,casey@example.com,415-555-0105,2001\n" +
  "Samantha,Rivera,sam@example.com,708-555-0140,2014\n";

async function setup(files: Record<string, string> = { "old.csv": OLD, "new.csv": NEW }) {
  const dir = await tempDir();
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text);
  const state = await loadSources(
    [
      { path: "old.csv", label: "old" },
      { path: "new.csv", label: "new" },
    ],
    dir,
  );
  return { dir, state };
}

const MATCH = "match:old:3+new:3";
const YEAR = "conflict:graduation_year:old:2+new:2";

test("loadSources validates the request before reading anything", async () => {
  const { dir } = await setup();
  const load = (specs: { path: string; label: string }[]) => loadSources(specs, dir);
  await assert.rejects(load([{ path: "old.csv", label: "old" }]), /between 2 and 5/);
  await assert.rejects(load([{ path: "old.csv", label: "Old File" }, { path: "new.csv", label: "new" }]), /Label "Old File"/);
  await assert.rejects(load([{ path: "old.csv", label: "a" }, { path: "./old.csv", label: "b" }]), /listed twice/);
  await assert.rejects(load([{ path: "old.txt", label: "a" }, { path: "new.csv", label: "b" }]), /only \.csv files/);
  await assert.rejects(load([{ path: "gone.csv", label: "a" }, { path: "new.csv", label: "b" }]), /file not found/);
});

test("malformed CSV errors name the source and the line", async () => {
  await assert.rejects(
    setup({ "old.csv": "Name,Phone\nx,1,2\n", "new.csv": NEW }),
    /Source "old" .*line 2: expected 2 columns but found 3/,
  );
});

test("a source file that changes after loading is rejected", async () => {
  const { dir, state } = await setup();
  await writeFile(path.join(dir, "new.csv"), NEW + "Ade,Bello,ade@example.com,,2021\n");
  await assert.rejects(openWorkspace(state), /changed after it was loaded/);
});

test("decisions are validated against the item type and can be replaced or reopened", async () => {
  const { state } = await setup();
  const ws = await openWorkspace(state);
  assert.throws(() => recordDecision(ws, MATCH, { kind: "leave_blank" }, undefined, FIXED_TIME), /same_person or different_people/);
  assert.throws(() => recordDecision(ws, YEAR, { kind: "same_person" }, undefined, FIXED_TIME), /choose_option/);
  assert.throws(() => recordDecision(ws, YEAR, { kind: "choose_option", option: "C" }, undefined, FIXED_TIME), /Options: A, B/);
  assert.throws(() => recordDecision(ws, YEAR, { kind: "enter_value", value: "20l1" }, undefined, FIXED_TIME), /four-digit year/);
  assert.throws(() => recordDecision(ws, "match:nope", { kind: "same_person" }, undefined, FIXED_TIME), /No current review item/);

  let next = recordDecision(ws, YEAR, { kind: "choose_option", option: "b" }, " typo in old file ", FIXED_TIME);
  next = recordDecision(await openWorkspace(next), YEAR, { kind: "choose_option", option: "A" }, undefined, FIXED_TIME);
  assert.deepEqual(next.decisions, [
    { itemId: YEAR, decidedAt: FIXED_TIME, type: "field", action: "use_value", value: "2011", origin: "source" },
  ]);
  assert.deepEqual(reopenDecision(next, YEAR).decisions, []);
});

test("changing a column mapping clears decisions", async () => {
  const { state } = await setup();
  const decided = recordDecision(await openWorkspace(state), MATCH, { kind: "same_person" }, undefined, FIXED_TIME);
  assert.throws(() => setColumnMapping(decided, { source: "new", target: "phone", column: "fax" }), /not a column of new/);
  const remapped = setColumnMapping(decided, { source: "new", target: "phone", column: null });
  assert.deepEqual(remapped.decisions, []);
  assert.equal(remapped.sources[1]?.mapping.columns.phone, undefined);
});

async function exportWith(state: ReconcilerState, dir: string, overrides: Partial<Parameters<typeof exportReconciliation>[1]> = {}) {
  const ws = await openWorkspace(state);
  const preview = buildPreview(ws, 50);
  return exportReconciliation(
    ws,
    {
      previewId: preview.previewId,
      unresolvedPolicy: "block",
      outputDir: "out",
      expectedMemberRows: preview.counts.outputMemberRows,
      expectedOpenItems: preview.openItemIds.length,
      ...overrides,
    },
    FIXED_TIME,
    dir,
  );
}

test("export refuses a stale preview, wrong counts, or open items under the block policy", async () => {
  const { dir, state } = await setup();
  await assert.rejects(exportWith(state, dir, { previewId: "000000000000" }), /out of date/);
  await assert.rejects(exportWith(state, dir, { expectedMemberRows: 99 }), /do not match the preview/);
  await assert.rejects(exportWith(state, dir), /2 review items are still open/);
});

test("approved export writes the merged CSV and audit report without touching the inputs", async () => {
  const { dir, state } = await setup();
  let next = recordDecision(await openWorkspace(state), YEAR, { kind: "choose_option", option: "A" }, "confirmed by registrar", FIXED_TIME);
  next = recordDecision(await openWorkspace(next), MATCH, { kind: "different_people" }, undefined, FIXED_TIME);

  const result = await exportWith(next, dir);
  assert.equal(result.memberRows, 3);
  assert.equal(path.dirname(result.csvPath), path.join(dir, "out"));
  assert.ok(result.csvPath.endsWith(`reconciled-members-${previewId(next)}.csv`));

  const rows = parseCsv(await readFile(result.csvPath, "utf8"));
  assert.deepEqual(rows.headers, [
    "member_key", "first_name", "last_name", "email", "phone", "graduation_year",
    "city", "status", "notes", "source_records", "review_flags",
  ]);
  assert.deepEqual(rows.rows[0]?.cells, [
    "M0001", "Casey", "Brennan", "casey@example.com", "+14155550105", "2011", "", "", "", "old:2; new:2", "",
  ]);

  const report = JSON.parse(await readFile(result.reportPath, "utf8"));
  assert.equal(report.decisions.length, 2);
  assert.equal(report.decisions[0].note, "confirmed by registrar");
  assert.deepEqual(report.members[0].fields.graduation_year.sources, [{ ref: "old:2", raw: "2011" }]);
  assert.deepEqual(report.openItemIds, []);

  assert.equal(await readFile(path.join(dir, "old.csv"), "utf8"), OLD);
  assert.equal(await readFile(path.join(dir, "new.csv"), "utf8"), NEW);
  await assert.rejects(exportWith(next, dir), /already exists/);
});

test("flag_for_review exports open items as blanks and separate rows, with explicit flags", async () => {
  const { dir, state } = await setup();
  const result = await exportWith(state, dir, { unresolvedPolicy: "flag_for_review" });
  assert.equal(result.openItemsFlagged, 2);
  const rows = parseCsv(await readFile(result.csvPath, "utf8")).rows.map((r) => r.cells);
  const flags = rows.map((r) => r[10]);
  assert.equal(rows[0]?.[5], "", "conflicting graduation year is left blank");
  assert.equal(flags[0], "graduation_year unresolved (2011 from old:2 vs 2001 from new:2); left blank");
  assert.equal(flags[1], "possible match with M0003 not reviewed (match:old:3+new:3); kept separate");
  assert.equal(flags[2], "possible match with M0002 not reviewed (match:old:3+new:3); kept separate");
});

test("cells that a spreadsheet could execute are prefixed with an apostrophe", async () => {
  const { dir, state } = await setup({
    "old.csv": 'Name,Phone,Notes\n"Ellis, Morgan",312-555-0101,"=HYPERLINK(""http://example.com"")"\n',
    "new.csv": "first_name,last_name,phone\nMorgan,Ellis,312-555-0101\n",
  });
  const result = await exportWith(state, dir);
  const row = parseCsv(await readFile(result.csvPath, "utf8")).rows[0]?.cells;
  assert.equal(row?.[8], `'=HYPERLINK("http://example.com")`);
  assert.equal(row?.[4], "+13125550101", "normalized phones keep their leading +");
});

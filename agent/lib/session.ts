// Session operations behind the agent's tools. Each function takes the current
// ReconcilerState and returns a new one or a view of it, so the eve tools stay
// thin and everything here can be tested without a model.
//
// The state stores only file paths, content hashes, mappings, and decisions.
// Every operation re-reads the input files, checks they have not changed, and
// recomputes the reconciliation deterministically.

import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CsvError, parseCsv, toCsv, type CsvTable } from "./csv.ts";
import {
  applyMapping,
  detectMapping,
  validateMapping,
  type ColumnMapping,
  type MappingChoice,
  type SourceRecord,
  type ValidationWarning,
} from "./mapping.ts";
import { normalizeField } from "./normalize.ts";
import { resolveInputCsv } from "./paths.ts";
import {
  reconcile,
  type CandidatePair,
  type Decision,
  type FieldConflict,
  type MergedMember,
  type ReconcileResult,
} from "./reconcile.ts";
import { CANONICAL_FIELDS, type CanonicalField, type FullNameFormat, type MappingTarget } from "./schema.ts";

export interface SourceState {
  label: string;
  path: string;
  sha256: string;
  headers: string[];
  mapping: ColumnMapping;
  pendingChoices: MappingChoice[];
  notes: string[];
}

export interface ReconcilerState {
  sources: SourceState[];
  decisions: Decision[];
}

export function emptyState(): ReconcilerState {
  return { sources: [], decisions: [] };
}

const LABEL_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function readTable(label: string, filePath: string): Promise<{ table: CsvTable; hash: string }> {
  const text = await readFile(filePath, "utf8");
  try {
    return { table: parseCsv(text), hash: sha256(text) };
  } catch (error) {
    if (error instanceof CsvError) throw new Error(`Source "${label}" (${filePath}): ${error.message}`);
    throw error;
  }
}

// ---------------------------------------------------------------- loading

export interface SourceSpec {
  path: string;
  label: string;
}

export async function loadSources(specs: SourceSpec[], cwd: string = process.cwd()): Promise<ReconcilerState> {
  if (specs.length < 2 || specs.length > 5) throw new Error("Load between 2 and 5 CSV files.");
  const labels = new Set<string>();
  const paths = new Set<string>();
  const sources: SourceState[] = [];

  for (const spec of specs) {
    if (!LABEL_PATTERN.test(spec.label)) {
      throw new Error(`Label "${spec.label}" must be lowercase letters, digits, - or _, starting with a letter.`);
    }
    if (labels.has(spec.label)) throw new Error(`Label "${spec.label}" is used twice.`);
    labels.add(spec.label);

    const real = await resolveInputCsv(spec.path, cwd);
    if (paths.has(real)) throw new Error(`${spec.path} is listed twice.`);
    paths.add(real);

    const { table, hash } = await readTable(spec.label, real);
    const detection = detectMapping(table);
    sources.push({
      label: spec.label,
      path: real,
      sha256: hash,
      headers: table.headers,
      mapping: detection.mapping,
      pendingChoices: detection.pendingChoices,
      notes: detection.notes,
    });
  }
  return { sources, decisions: [] };
}

export interface MappingUpdate {
  source: string;
  target: MappingTarget;
  /** Column to use, or null to leave the target unmapped. */
  column: string | null;
  fullNameFormat?: FullNameFormat;
}

/** Change one mapping target. Clears all review decisions, because record values change. */
export function setColumnMapping(state: ReconcilerState, update: MappingUpdate): ReconcilerState {
  const source = state.sources.find((s) => s.label === update.source);
  if (source === undefined) throw new Error(`No loaded source is labelled "${update.source}".`);
  if (update.column !== null && !source.headers.includes(update.column)) {
    throw new Error(`"${update.column}" is not a column of ${update.source}. Columns: ${source.headers.join(", ")}.`);
  }

  const columns = { ...source.mapping.columns };
  if (update.column === null) delete columns[update.target];
  else columns[update.target] = update.column;
  const mapping: ColumnMapping = { columns };
  const format = update.target === "full_name" ? update.fullNameFormat : source.mapping.fullNameFormat;
  if (columns.full_name !== undefined && format !== undefined) mapping.fullNameFormat = format;

  const updated: SourceState = {
    ...source,
    mapping,
    pendingChoices: source.pendingChoices.filter((c) => c.target !== update.target),
  };
  return {
    sources: state.sources.map((s) => (s.label === update.source ? updated : s)),
    decisions: [],
  };
}

// ---------------------------------------------------------------- workspace

export interface Workspace {
  state: ReconcilerState;
  rowCounts: Record<string, number>;
  records: SourceRecord[];
  warnings: ValidationWarning[];
  /** Mapping problems or open mapping questions. Reconciliation waits until this is empty. */
  blockers: string[];
  result: ReconcileResult | null;
}

/** Re-read the sources, verify they are unchanged, and reconcile with the current decisions. */
export async function openWorkspace(state: ReconcilerState): Promise<Workspace> {
  if (state.sources.length === 0) throw new Error("No sources are loaded yet. Use load_sources first.");
  const rowCounts: Record<string, number> = {};
  const records: SourceRecord[] = [];
  const warnings: ValidationWarning[] = [];
  const blockers: string[] = [];

  for (const source of state.sources) {
    const { table, hash } = await readTable(source.label, source.path);
    if (hash !== source.sha256) {
      throw new Error(`${source.path} changed after it was loaded. Load the sources again to start over.`);
    }
    rowCounts[source.label] = table.rows.length;
    for (const choice of source.pendingChoices) blockers.push(`${source.label}: ${choice.question}`);
    const problems = validateMapping(source.mapping, source.headers);
    for (const problem of problems) blockers.push(`${source.label}: ${problem}`);
    if (problems.length === 0) {
      const applied = applyMapping(source.label, table, source.mapping);
      records.push(...applied.records);
      warnings.push(...applied.warnings);
    }
  }

  const result = blockers.length === 0 ? reconcile(records, state.decisions) : null;
  return { state, rowCounts, records, warnings, blockers, result };
}

const WARNING_LIMIT = 50;

/** Overview returned after loading or remapping sources. */
export function summarize(ws: Workspace) {
  const result = ws.result;
  return {
    sources: ws.state.sources.map((s) => ({
      label: s.label,
      path: s.path,
      rows: ws.rowCounts[s.label],
      columns: s.headers,
      mapping: s.mapping.columns,
      fullNameFormat: s.mapping.fullNameFormat ?? null,
      mappingNotes: s.notes,
      pendingMappingQuestions: s.pendingChoices,
    })),
    mappingBlockers: ws.blockers,
    validationWarningCount: ws.warnings.length,
    validationWarnings: ws.warnings.slice(0, WARNING_LIMIT),
    review:
      result === null
        ? null
        : {
            autoMatches: result.pairs.filter((p) => p.status === "auto").length,
            keptSeparateByRule: result.pairs.filter((p) => p.status === "distinct").length,
            openMatchReviews: result.pairs.filter((p) => p.status === "review").length,
            openFieldConflicts: result.conflicts.filter((c) => c.status === "open").length,
          },
  };
}

function requireResult(ws: Workspace): ReconcileResult {
  if (ws.result === null) {
    throw new Error(`Column mapping must be settled first:\n- ${ws.blockers.join("\n- ")}`);
  }
  return ws.result;
}

// ---------------------------------------------------------------- views

export interface RecordView {
  ref: string;
  recordId: string | null;
  values: Partial<Record<CanonicalField, string>>;
}

function recordView(ws: Workspace, ref: string): RecordView {
  const record = ws.records.find((r) => r.ref === ref);
  if (record === undefined) throw new Error(`Unknown record ${ref}.`);
  const values: Partial<Record<CanonicalField, string>> = {};
  for (const field of CANONICAL_FIELDS) {
    const fv = record.fields[field];
    if (fv !== undefined) values[field] = fv.value;
  }
  return { ref, recordId: record.recordId, values };
}

export type ReviewItem =
  | {
      id: string;
      type: "match";
      question: string;
      whyReview: string;
      evidence: string[];
      records: RecordView[];
      allowedResolutions: ("same_person" | "different_people")[];
    }
  | {
      id: string;
      type: "field_conflict";
      question: string;
      field: CanonicalField;
      options: { option: string; value: string; sourceRefs: string[] }[];
      records: RecordView[];
      allowedResolutions: ("choose_option" | "enter_value" | "leave_blank")[];
    };

function matchItem(ws: Workspace, pair: CandidatePair): ReviewItem {
  return {
    id: pair.id,
    type: "match",
    question: `Are ${pair.refs[0]} and ${pair.refs[1]} the same person?`,
    whyReview: pair.statusReason,
    evidence: pair.reasons,
    records: pair.refs.map((ref) => recordView(ws, ref)),
    allowedResolutions: ["same_person", "different_people"],
  };
}

function conflictItem(ws: Workspace, conflict: FieldConflict): ReviewItem {
  return {
    id: conflict.id,
    type: "field_conflict",
    question: `These records were matched as one member but disagree on ${conflict.field}. Which value should be kept?`,
    field: conflict.field,
    options: conflict.options.map((o) => ({
      option: o.option,
      value: o.value,
      sourceRefs: o.sources.map((s) => s.ref),
    })),
    records: conflict.memberRefs.map((ref) => recordView(ws, ref)),
    allowedResolutions: ["choose_option", "enter_value", "leave_blank"],
  };
}

function openItems(ws: Workspace): ReviewItem[] {
  const result = requireResult(ws);
  return [
    ...result.pairs.filter((p) => p.status === "review").map((p) => matchItem(ws, p)),
    ...result.conflicts.filter((c) => c.status === "open").map((c) => conflictItem(ws, c)),
  ];
}

export function reviewQueue(ws: Workspace, limit: number) {
  const items = openItems(ws);
  return {
    openItems: items.length,
    openMatchReviews: items.filter((i) => i.type === "match").length,
    openFieldConflicts: items.filter((i) => i.type === "field_conflict").length,
    items: items.slice(0, limit),
    staleDecisions: requireResult(ws).staleDecisions.map((s) => ({ itemId: s.decision.itemId, reason: s.reason })),
  };
}

// ---------------------------------------------------------------- decisions

export type Resolution =
  | { kind: "same_person" }
  | { kind: "different_people" }
  | { kind: "choose_option"; option: string }
  | { kind: "enter_value"; value: string }
  | { kind: "leave_blank" };

/** Record or replace the decision for one item (open or already decided). */
export function recordDecision(
  ws: Workspace,
  itemId: string,
  resolution: Resolution,
  note: string | undefined,
  decidedAt: string,
): ReconcilerState {
  const result = requireResult(ws);
  const base = note === undefined || note.trim() === "" ? { itemId, decidedAt } : { itemId, decidedAt, note: note.trim() };
  let decision: Decision;

  const pair = result.pairs.find((p) => p.id === itemId);
  const conflict = result.conflicts.find((c) => c.id === itemId);
  if (pair !== undefined) {
    if (resolution.kind !== "same_person" && resolution.kind !== "different_people") {
      throw new Error(`${itemId} is a match question; resolve it with same_person or different_people.`);
    }
    decision = { ...base, type: "match", verdict: resolution.kind };
  } else if (conflict !== undefined) {
    if (resolution.kind === "choose_option") {
      const chosen = conflict.options.find((o) => o.option === resolution.option.trim().toUpperCase());
      if (chosen === undefined) {
        throw new Error(`Option "${resolution.option}" does not exist. Options: ${conflict.options.map((o) => o.option).join(", ")}.`);
      }
      decision = { ...base, type: "field", action: "use_value", value: chosen.value, origin: "source" };
    } else if (resolution.kind === "enter_value") {
      const normalized = normalizeField(conflict.field, resolution.value);
      if (normalized === null) throw new Error("The entered value is empty; use leave_blank instead.");
      if (!normalized.ok) throw new Error(`The entered ${conflict.field} is invalid: ${normalized.reason}.`);
      decision = { ...base, type: "field", action: "use_value", value: normalized.value, origin: "reviewer" };
    } else if (resolution.kind === "leave_blank") {
      decision = { ...base, type: "field", action: "leave_blank" };
    } else {
      throw new Error(`${itemId} is a field conflict; resolve it with choose_option, enter_value, or leave_blank.`);
    }
  } else {
    throw new Error(`No current review item has id "${itemId}". Fetch the review queue again.`);
  }

  return {
    sources: ws.state.sources,
    decisions: [...ws.state.decisions.filter((d) => d.itemId !== itemId), decision],
  };
}

export function reopenDecision(state: ReconcilerState, itemId: string): ReconcilerState {
  if (!state.decisions.some((d) => d.itemId === itemId)) throw new Error(`No decision is recorded for "${itemId}".`);
  return { ...state, decisions: state.decisions.filter((d) => d.itemId !== itemId) };
}

// ---------------------------------------------------------------- preview

export function previewId(state: ReconcilerState): string {
  const fingerprint = {
    sources: state.sources.map((s) => ({ label: s.label, path: s.path, sha256: s.sha256, mapping: s.mapping })),
    decisions: [...state.decisions].sort((a, b) => a.itemId.localeCompare(b.itemId)),
  };
  return sha256(JSON.stringify(fingerprint)).slice(0, 12);
}

function memberRow(member: MergedMember) {
  const values: Partial<Record<CanonicalField, string | null>> = {};
  const unresolvedFields: CanonicalField[] = [];
  for (const field of CANONICAL_FIELDS) {
    const merged = member.fields[field];
    values[field] = merged.value;
    if (merged.resolution === "unresolved") unresolvedFields.push(field);
  }
  return { memberKey: member.memberKey, sourceRefs: member.refs, values, unresolvedFields };
}

export function buildPreview(ws: Workspace, memberLimit: number) {
  const result = requireResult(ws);
  const items = openItems(ws);
  const merged = result.members.filter((m) => m.refs.length > 1);
  const single = result.members.filter((m) => m.refs.length === 1);
  const count = (status: CandidatePair["status"]) => result.pairs.filter((p) => p.status === status).length;

  return {
    previewId: previewId(ws.state),
    readyToExportWithoutFlags: items.length === 0 && result.inconsistencies.length === 0,
    counts: {
      inputRows: ws.rowCounts,
      recordsReconciled: ws.records.length,
      outputMemberRows: result.members.length,
      mergedMembers: merged.length,
      singleSourceMembers: single.length,
      autoMatches: count("auto"),
      confirmedMatches: count("confirmed"),
      rejectedMatches: count("rejected"),
      keptSeparateByRule: count("distinct"),
      openMatchReviews: items.filter((i) => i.type === "match").length,
      openFieldConflicts: items.filter((i) => i.type === "field_conflict").length,
      resolvedFieldConflicts: result.conflicts.filter((c) => c.status === "resolved").length,
      validationWarnings: ws.warnings.length,
    },
    inconsistencies: result.inconsistencies,
    mergedMembers: merged.slice(0, memberLimit).map(memberRow),
    singleSourceMembers: single.slice(0, memberLimit).map(memberRow),
    truncated: merged.length > memberLimit || single.length > memberLimit,
    matches: result.pairs
      .filter((p) => p.status !== "review")
      .map((p) => ({ id: p.id, status: p.status, statusReason: p.statusReason, evidence: p.reasons })),
    openItemIds: items.map((i) => i.id),
    validationWarningCount: ws.warnings.length,
    validationWarnings: ws.warnings.slice(0, WARNING_LIMIT),
    staleDecisions: result.staleDecisions.map((s) => ({ itemId: s.decision.itemId, reason: s.reason })),
  };
}

// ---------------------------------------------------------------- export

export type UnresolvedPolicy = "block" | "flag_for_review";

export interface ExportRequest {
  previewId: string;
  unresolvedPolicy: UnresolvedPolicy;
  outputDir: string;
  /** Counts copied from the preview; the export refuses if they no longer match. */
  expectedMemberRows: number;
  expectedOpenItems: number;
}

export const OUTPUT_COLUMNS = ["member_key", ...CANONICAL_FIELDS, "source_records", "review_flags"] as const;

/** Prefix cells that a spreadsheet could run as a formula. Phones are always "+digits". */
function guardFormula(value: string, field: string): string {
  return field !== "phone" && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function reviewFlags(member: MergedMember, result: ReconcileResult, keyByRef: Map<string, string>): string[] {
  const flags: string[] = [];
  for (const conflict of result.conflicts) {
    if (conflict.status !== "open" || conflict.memberRefs[0] !== member.refs[0]) continue;
    const options = conflict.options.map((o) => `${o.value} from ${o.sources.map((s) => s.ref).join(", ")}`);
    flags.push(`${conflict.field} unresolved (${options.join(" vs ")}); left blank`);
  }
  for (const pair of result.pairs) {
    if (pair.status !== "review") continue;
    const mine = pair.refs.filter((ref) => member.refs.includes(ref));
    const other = pair.refs.find((ref) => !member.refs.includes(ref));
    if (mine.length === 0) continue;
    flags.push(
      other === undefined
        ? `unreviewed possible duplicate inside this member (${pair.id})`
        : `possible match with ${keyByRef.get(other)} not reviewed (${pair.id}); kept separate`,
    );
  }
  return flags;
}

export async function exportReconciliation(
  ws: Workspace,
  request: ExportRequest,
  generatedAt: string,
  cwd: string = process.cwd(),
) {
  const result = requireResult(ws);
  const currentId = previewId(ws.state);
  if (request.previewId !== currentId) {
    throw new Error(`Preview ${request.previewId} is out of date (current state is ${currentId}). Run preview_reconciliation again and show it to the user.`);
  }
  if (result.inconsistencies.length > 0) {
    throw new Error(`Export blocked by contradictory decisions:\n- ${result.inconsistencies.join("\n- ")}`);
  }
  const items = openItems(ws);
  if (request.expectedMemberRows !== result.members.length || request.expectedOpenItems !== items.length) {
    throw new Error(
      `The approved counts (${request.expectedMemberRows} rows, ${request.expectedOpenItems} open items) do not match the preview (${result.members.length} rows, ${items.length} open items).`,
    );
  }
  if (items.length > 0 && request.unresolvedPolicy === "block") {
    throw new Error(
      `${items.length} review items are still open, and the policy is "block". Resolve them, or ask the user to approve the "flag_for_review" policy.`,
    );
  }

  const outputDir = path.resolve(cwd, request.outputDir);
  const csvPath = path.join(outputDir, `reconciled-members-${currentId}.csv`);
  const reportPath = path.join(outputDir, `reconciliation-report-${currentId}.json`);
  const inputPaths = new Set(ws.state.sources.map((s) => s.path));
  if (inputPaths.has(csvPath) || inputPaths.has(reportPath)) {
    throw new Error("Refusing to write over an input file.");
  }

  const keyByRef = new Map(result.members.flatMap((m) => m.refs.map((ref) => [ref, m.memberKey] as const)));
  const rows = result.members.map((member) => {
    const cells = CANONICAL_FIELDS.map((field) => guardFormula(member.fields[field].value ?? "", field));
    return [
      member.memberKey,
      ...cells,
      member.refs.join("; "),
      guardFormula(reviewFlags(member, result, keyByRef).join("; "), "review_flags"),
    ];
  });

  const report = {
    reportVersion: 1,
    generatedAt,
    previewId: currentId,
    unresolvedPolicy: request.unresolvedPolicy,
    outputCsv: path.basename(csvPath),
    sources: ws.state.sources.map((s) => ({
      label: s.label,
      path: s.path,
      sha256: s.sha256,
      rows: ws.rowCounts[s.label],
      mapping: s.mapping,
    })),
    members: result.members,
    matches: result.pairs.map(({ id, refs, evidence, reasons, status, statusReason }) => ({
      id,
      refs,
      status,
      statusReason,
      evidence,
      reasons,
    })),
    conflicts: result.conflicts,
    decisions: ws.state.decisions,
    staleDecisions: result.staleDecisions,
    openItemIds: items.map((i) => i.id),
    validationWarnings: ws.warnings,
  };

  for (const target of [csvPath, reportPath]) {
    if (await exists(target)) {
      throw new Error(`${target} already exists; this preview was already exported. Nothing was written.`);
    }
  }
  await mkdir(outputDir, { recursive: true });
  // "wx" also fails if the file appeared since the check, so nothing is overwritten.
  await writeFile(csvPath, toCsv(OUTPUT_COLUMNS, rows), { flag: "wx" });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });

  return {
    csvPath,
    reportPath,
    memberRows: rows.length,
    openItemsFlagged: items.length,
  };
}

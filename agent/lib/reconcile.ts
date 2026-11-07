// Candidate matching, conservative auto-merge, clustering, provenance, and
// conflict detection. Pure functions: no file access, no clock, no model.
// README.md "Matching rules" documents the rules implemented here.

import type { FieldValue, SourceRecord } from "./mapping.ts";
import { CANONICAL_FIELDS, isMultiValueField, type CanonicalField } from "./schema.ts";

export type Signal = "match" | "conflict" | "missing";
export type NameSignal = "exact" | "compatible" | "different" | "missing";

export interface PairEvidence {
  name: NameSignal;
  email: Signal;
  phone: Signal;
  graduation_year: Signal;
}

/** What the matching rules alone say about a pair, before uniqueness and decisions. */
export type RuleOutcome = "auto_eligible" | "review" | "distinct";

/**
 * auto:      merged by the conservative rule
 * review:    needs a person to decide
 * distinct:  kept separate by rule (contradicting evidence, no shared identifier)
 * confirmed: a person said "same person"
 * rejected:  a person said "different people"
 */
export type MatchStatus = "auto" | "review" | "distinct" | "confirmed" | "rejected";

export interface CandidatePair {
  id: string;
  refs: [string, string];
  evidence: PairEvidence;
  reasons: string[];
  outcome: RuleOutcome;
  status: MatchStatus;
  statusReason: string;
}

export type Decision =
  | {
      type: "match";
      itemId: string;
      verdict: "same_person" | "different_people";
      note?: string;
      decidedAt: string;
    }
  | {
      type: "field";
      itemId: string;
      action: "use_value";
      /** Normalized value. */
      value: string;
      /** "source": one of the conflicting values; "reviewer": typed by the person. */
      origin: "source" | "reviewer";
      note?: string;
      decidedAt: string;
    }
  | {
      type: "field";
      itemId: string;
      action: "leave_blank";
      note?: string;
      decidedAt: string;
    };

export interface Provenance {
  ref: string;
  raw: string;
}

export interface ConflictOption {
  option: string;
  value: string;
  sources: Provenance[];
}

export interface FieldConflict {
  id: string;
  field: CanonicalField;
  memberRefs: string[];
  options: ConflictOption[];
  status: "open" | "resolved";
}

export interface MergedField {
  value: string | null;
  /** Source rows that supplied the retained value. Empty for a reviewer-typed value. */
  sources: Provenance[];
  conflictId?: string;
  /** How a conflict was settled, when there was one. */
  resolution?: "reviewer_chose_source_value" | "reviewer_entered_value" | "reviewer_left_blank" | "unresolved";
}

export interface MergedMember {
  memberKey: string;
  refs: string[];
  recordIds: string[];
  fields: Record<CanonicalField, MergedField>;
}

export interface ReconcileResult {
  pairs: CandidatePair[];
  members: MergedMember[];
  conflicts: FieldConflict[];
  /** Decisions that no longer apply to any current item, with the reason. */
  staleDecisions: { decision: Decision; reason: string }[];
  /** Decisions that contradict each other; these block export. */
  inconsistencies: string[];
}

function compareSignal(a: FieldValue | undefined, b: FieldValue | undefined): Signal {
  if (a === undefined || b === undefined) return "missing";
  return a.key === b.key ? "match" : "conflict";
}

function compareNames(a: SourceRecord, b: SourceRecord): NameSignal {
  const lastA = a.fields.last_name?.key;
  const lastB = b.fields.last_name?.key;
  if (lastA === undefined || lastB === undefined) return "missing";
  if (lastA !== lastB) return "different";
  const firstA = a.fields.first_name?.key;
  const firstB = b.fields.first_name?.key;
  if (firstA === undefined || firstB === undefined) return "compatible";
  if (firstA === firstB) return "exact";
  return firstA.startsWith(firstB) || firstB.startsWith(firstA) ? "compatible" : "different";
}

function displayName(r: SourceRecord): string {
  return [r.fields.first_name?.value, r.fields.last_name?.value].filter(Boolean).join(" ") || "(no name)";
}

const FIELD_LABELS = { email: "Email", phone: "Phone", graduation_year: "Graduation year" } as const;

export function evaluatePair(a: SourceRecord, b: SourceRecord): {
  evidence: PairEvidence;
  reasons: string[];
  outcome: RuleOutcome;
} {
  const evidence: PairEvidence = {
    name: compareNames(a, b),
    email: compareSignal(a.fields.email, b.fields.email),
    phone: compareSignal(a.fields.phone, b.fields.phone),
    graduation_year: compareSignal(a.fields.graduation_year, b.fields.graduation_year),
  };

  const reasons: string[] = [];
  const nameText = {
    exact: `Names are identical after normalization (${displayName(a)}).`,
    compatible: `Same last name; first names are compatible but not identical (${displayName(a)} / ${displayName(b)}).`,
    different: `Names differ (${displayName(a)} / ${displayName(b)}).`,
    missing: "At least one record has no last name to compare.",
  }[evidence.name];
  reasons.push(nameText);
  for (const field of ["email", "phone", "graduation_year"] as const) {
    const label = FIELD_LABELS[field];
    const signal = evidence[field];
    if (signal === "match") reasons.push(`${label} matches (${a.fields[field]?.value}).`);
    else if (signal === "conflict")
      reasons.push(`${label} differs (${a.fields[field]?.value} vs ${b.fields[field]?.value}).`);
    else reasons.push(`${label} is missing from at least one record, so it cannot be compared.`);
  }

  const identifierMatches = [evidence.email, evidence.phone].filter((s) => s === "match").length;
  const identifierConflicts = [evidence.email, evidence.phone].filter((s) => s === "conflict").length;
  const conflicts = [evidence.email, evidence.phone, evidence.graduation_year].filter(
    (s) => s === "conflict",
  ).length;

  let outcome: RuleOutcome;
  if (identifierMatches === 0 && conflicts >= 2) outcome = "distinct";
  else if (evidence.name === "exact" && identifierMatches >= 1 && identifierConflicts === 0) outcome = "auto_eligible";
  else outcome = "review";

  return { evidence, reasons, outcome };
}

/** Which parts of the automatic merge rule a pair fails. */
function autoMergeBlockers(evidence: PairEvidence): string[] {
  const identifiers = [evidence.email, evidence.phone];
  const blockers: string[] = [];
  if (evidence.name !== "exact") blockers.push("names are not identical");
  if (!identifiers.includes("match")) blockers.push("no shared email or phone");
  if (identifiers.includes("conflict")) blockers.push("email or phone conflicts");
  return blockers;
}

/** Pairs worth evaluating: shared email, shared phone, or same last name with compatible first names. */
function candidateIndexPairs(records: SourceRecord[]): [number, number][] {
  const buckets = new Map<string, number[]>();
  records.forEach((record, index) => {
    const keys = [
      record.fields.email && `email:${record.fields.email.key}`,
      record.fields.phone && `phone:${record.fields.phone.key}`,
      record.fields.last_name && `last:${record.fields.last_name.key}`,
    ];
    for (const key of keys) {
      if (!key) continue;
      buckets.set(key, [...(buckets.get(key) ?? []), index]);
    }
  });

  const seen = new Set<string>();
  const pairs: [number, number][] = [];
  for (const indexes of buckets.values()) {
    for (let x = 0; x < indexes.length; x++) {
      for (let y = x + 1; y < indexes.length; y++) {
        const i = indexes[x]!;
        const j = indexes[y]!;
        const id = `${i},${j}`;
        if (seen.has(id)) continue;
        seen.add(id);
        pairs.push([i, j]);
      }
    }
  }
  return pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

class UnionFind {
  private readonly parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]!]!;
      i = this.parent[i]!;
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

export function conflictId(field: CanonicalField, refs: readonly string[]): string {
  return `conflict:${field}:${refs.join("+")}`;
}

/**
 * Reconcile normalized records. `records` must be in a stable order (source
 * load order, then line); that order decides display ties and member keys.
 */
export function reconcile(records: SourceRecord[], decisions: readonly Decision[]): ReconcileResult {
  const decisionById = new Map(decisions.map((d) => [d.itemId, d]));
  const usedDecisions = new Set<string>();
  const staleDecisions: ReconcileResult["staleDecisions"] = [];

  // 1. Candidate pairs and rule outcomes.
  const indexPairs = candidateIndexPairs(records);
  const pairs: CandidatePair[] = [];
  const pairIndexes: [number, number][] = [];
  for (const [i, j] of indexPairs) {
    const a = records[i]!;
    const b = records[j]!;
    const { evidence, reasons, outcome } = evaluatePair(a, b);
    const related =
      evidence.name === "exact" ||
      evidence.name === "compatible" ||
      evidence.email === "match" ||
      evidence.phone === "match";
    if (!related) continue;
    pairs.push({
      id: `match:${a.ref}+${b.ref}`,
      refs: [a.ref, b.ref],
      evidence,
      reasons,
      outcome,
      status: "review",
      statusReason: "",
    });
    pairIndexes.push([i, j]);
  }

  // 2. Apply match decisions, then the uniqueness requirement for auto-merge.
  const openCount = new Map<string, number>();
  for (const pair of pairs) {
    const decision = decisionById.get(pair.id);
    if (decision?.type === "match") {
      usedDecisions.add(pair.id);
      pair.status = decision.verdict === "same_person" ? "confirmed" : "rejected";
      pair.statusReason = `Reviewer decided: ${decision.verdict.replace("_", " ")}.`;
      continue;
    }
    if (pair.outcome === "distinct") {
      pair.status = "distinct";
      pair.statusReason = "Kept separate: no shared email or phone, and at least two of email, phone, and graduation year differ.";
      continue;
    }
    for (const ref of pair.refs) openCount.set(ref, (openCount.get(ref) ?? 0) + 1);
  }
  for (const pair of pairs) {
    if (pair.status !== "review") continue;
    if (pair.outcome === "review") {
      pair.statusReason = `Needs review: ${autoMergeBlockers(pair.evidence).join("; ")}.`;
      continue;
    }
    const competing = pair.refs.filter((ref) => (openCount.get(ref) ?? 0) > 1);
    if (competing.length === 0) {
      pair.status = "auto";
      pair.statusReason = "Merged automatically: identical name, a shared email or phone, no conflicting email or phone, and no competing candidate.";
    } else {
      pair.statusReason = `Needs review: ${competing.join(" and ")} also has another possible match.`;
    }
  }

  // 3. Cluster records joined by auto or confirmed matches.
  const uf = new UnionFind(records.length);
  pairs.forEach((pair, k) => {
    if (pair.status === "auto" || pair.status === "confirmed") uf.union(...pairIndexes[k]!);
  });
  const inconsistencies: string[] = [];
  pairs.forEach((pair, k) => {
    const [i, j] = pairIndexes[k]!;
    if (pair.status === "rejected" && uf.find(i) === uf.find(j)) {
      inconsistencies.push(
        `${pair.refs[0]} and ${pair.refs[1]} were marked as different people, but other matches join them into one member. Reopen one of those decisions.`,
      );
    }
  });

  const clusters = new Map<number, number[]>();
  records.forEach((_, i) => {
    const root = uf.find(i);
    clusters.set(root, [...(clusters.get(root) ?? []), i]);
  });

  // 4. Merge fields with provenance; disagreements become conflicts.
  const members: MergedMember[] = [];
  const conflicts: FieldConflict[] = [];
  [...clusters.values()].forEach((indexes, memberIndex) => {
    const group = indexes.map((i) => records[i]!);
    const refs = group.map((r) => r.ref);
    const fields = {} as Record<CanonicalField, MergedField>;

    for (const field of CANONICAL_FIELDS) {
      // Values that share a comparison key agree; the first record's spelling is kept.
      const byKey = new Map<string, ConflictOption>();
      for (const record of group) {
        const fv = record.fields[field];
        if (fv === undefined) continue;
        const provenance = { ref: record.ref, raw: fv.raw };
        const existing = byKey.get(fv.key);
        if (existing) existing.sources.push(provenance);
        else byKey.set(fv.key, { option: String.fromCharCode(65 + byKey.size), value: fv.value, sources: [provenance] });
      }
      const options = [...byKey.values()];

      if (options.length === 0) {
        fields[field] = { value: null, sources: [] };
      } else if (isMultiValueField(field)) {
        fields[field] = { value: options.map((o) => o.value).join(" | "), sources: options.flatMap((o) => o.sources) };
      } else if (options.length === 1) {
        fields[field] = { value: options[0]!.value, sources: options[0]!.sources };
      } else {
        const id = conflictId(field, refs);
        const decision = decisionById.get(id);
        let merged: MergedField = { value: null, sources: [], conflictId: id, resolution: "unresolved" };
        if (decision?.type === "field") {
          if (decision.action === "leave_blank") {
            merged = { value: null, sources: [], conflictId: id, resolution: "reviewer_left_blank" };
            usedDecisions.add(id);
          } else if (decision.origin === "reviewer") {
            merged = { value: decision.value, sources: [], conflictId: id, resolution: "reviewer_entered_value" };
            usedDecisions.add(id);
          } else {
            const chosen = options.find((o) => o.value === decision.value);
            if (chosen) {
              merged = { value: chosen.value, sources: chosen.sources, conflictId: id, resolution: "reviewer_chose_source_value" };
              usedDecisions.add(id);
            }
          }
        }
        fields[field] = merged;
        conflicts.push({
          id,
          field,
          memberRefs: refs,
          options,
          status: merged.resolution === "unresolved" ? "open" : "resolved",
        });
      }
    }

    members.push({
      memberKey: `M${String(memberIndex + 1).padStart(4, "0")}`,
      refs,
      recordIds: group.flatMap((r) => (r.recordId === null ? [] : [r.recordId])),
      fields,
    });
  });

  for (const decision of decisions) {
    if (usedDecisions.has(decision.itemId)) continue;
    const reason = pairs.some((p) => p.id === decision.itemId) || conflicts.some((c) => c.id === decision.itemId)
      ? "the chosen value is no longer one of the options"
      : "the item no longer exists (matches changed which records form this member)";
    staleDecisions.push({ decision, reason });
  }

  return { pairs, members, conflicts, staleDecisions, inconsistencies };
}

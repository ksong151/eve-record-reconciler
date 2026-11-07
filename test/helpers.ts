import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseCsv } from "../agent/lib/csv.ts";
import { applyMapping, detectMapping, type SourceRecord } from "../agent/lib/mapping.ts";

/** Parse inline CSV sources (fictional data) into normalized records, in the given order. */
export function recordsFrom(sources: Record<string, string>): SourceRecord[] {
  return Object.entries(sources).flatMap(([label, text]) => {
    const table = parseCsv(text);
    const { mapping, pendingChoices } = detectMapping(table);
    if (pendingChoices.length > 0) throw new Error(`test CSV ${label} has an ambiguous mapping`);
    return applyMapping(label, table, mapping).records;
  });
}

export function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "reconciler-test-"));
}

export const FIXED_TIME = "2026-01-01T00:00:00.000Z";

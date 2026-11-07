// Column mapping: detect which source column feeds each canonical field, let a
// person override it, and turn CSV rows into normalized source records.

import type { CsvTable } from "./csv.ts";
import { cleanText, normalizeField } from "./normalize.ts";
import {
  CANONICAL_FIELDS,
  HEADER_ALIASES,
  MAPPING_TARGETS,
  normalizeHeader,
  type CanonicalField,
  type FullNameFormat,
  type MappingTarget,
} from "./schema.ts";

export interface ColumnMapping {
  /** Source header for each mapped target. Unmapped targets are absent. */
  columns: Partial<Record<MappingTarget, string>>;
  /** Required when `columns.full_name` is set. */
  fullNameFormat?: FullNameFormat;
}

/** A mapping question detection could not answer on its own. */
export interface MappingChoice {
  target: MappingTarget;
  question: string;
  candidates: string[];
}

export interface MappingDetection {
  mapping: ColumnMapping;
  pendingChoices: MappingChoice[];
  notes: string[];
}

export interface FieldValue {
  value: string;
  key: string;
  /** The original cell text, kept for provenance. */
  raw: string;
}

export interface SourceRecord {
  /** `<source label>:<line>`, e.g. `legacy:5`. */
  ref: string;
  source: string;
  line: number;
  recordId: string | null;
  fields: Partial<Record<CanonicalField, FieldValue>>;
}

export interface ValidationWarning {
  ref: string;
  field: CanonicalField | "full_name" | "row";
  raw: string;
  message: string;
}

function detectFullNameFormat(
  table: CsvTable,
  column: string,
): { format: FullNameFormat; note: string } | null {
  const index = table.headers.indexOf(column);
  const values = table.rows.map((row) => cleanText(row.cells[index] ?? "")).filter((v) => v !== null);
  const withComma = values.filter((v) => v.includes(",")).length;
  if (values.length > 0 && withComma === values.length) {
    return { format: "last_comma_first", note: `"${column}" holds "Last, First" names.` };
  }
  if (withComma === 0) {
    return {
      format: "first_last",
      note: `"${column}" has no commas, so names are read as "First Last" (the last word is the last name).`,
    };
  }
  return null;
}

export function detectMapping(table: CsvTable): MappingDetection {
  const byTarget = new Map<MappingTarget, string[]>();
  for (const header of table.headers) {
    const normalized = normalizeHeader(header);
    const target = MAPPING_TARGETS.find((t) => HEADER_ALIASES[t].includes(normalized));
    if (target === undefined) continue;
    byTarget.set(target, [...(byTarget.get(target) ?? []), header]);
  }

  const mapping: ColumnMapping = { columns: {} };
  const pendingChoices: MappingChoice[] = [];
  const notes: string[] = [];

  for (const [target, headers] of byTarget) {
    if (headers.length === 1) {
      mapping.columns[target] = headers[0];
    } else {
      pendingChoices.push({
        target,
        question: `Columns ${headers.map((h) => `"${h}"`).join(" and ")} all look like ${target}. Which one should be used (or none)?`,
        candidates: headers,
      });
    }
  }

  const { columns } = mapping;
  if (columns.first_name !== undefined && columns.last_name !== undefined && columns.full_name !== undefined) {
    notes.push(`"${columns.full_name}" is ignored because separate first and last name columns exist.`);
    delete columns.full_name;
  }
  if (columns.full_name !== undefined) {
    const detected = detectFullNameFormat(table, columns.full_name);
    if (detected === null) {
      pendingChoices.push({
        target: "full_name",
        question: `Some "${columns.full_name}" values contain a comma and some do not. Are names written "Last, First" or "First Last"?`,
        candidates: ["last_comma_first", "first_last"],
      });
    } else {
      mapping.fullNameFormat = detected.format;
      notes.push(detected.note);
    }
  }

  const mapped = new Set(Object.values(columns));
  const ignored = table.headers.filter(
    (h) => !mapped.has(h) && !pendingChoices.some((c) => c.candidates.includes(h)),
  );
  if (ignored.length > 0) {
    notes.push(`Not mapped (ignored): ${ignored.map((h) => `"${h}"`).join(", ")}.`);
  }

  return { mapping, pendingChoices, notes };
}

/** Problems that make a mapping unusable. An empty list means it can be applied. */
export function validateMapping(mapping: ColumnMapping, headers: readonly string[]): string[] {
  const problems: string[] = [];
  const usedBy = new Map<string, MappingTarget>();
  for (const target of MAPPING_TARGETS) {
    const column = mapping.columns[target];
    if (column === undefined) continue;
    if (!headers.includes(column)) {
      problems.push(`${target} is mapped to "${column}", which is not a column in this file.`);
    }
    const other = usedBy.get(column);
    if (other !== undefined) {
      problems.push(`"${column}" is mapped to both ${other} and ${target}.`);
    }
    usedBy.set(column, target);
  }

  const { first_name, last_name, full_name } = mapping.columns;
  const hasSplitName = first_name !== undefined && last_name !== undefined;
  if (full_name !== undefined && (first_name !== undefined || last_name !== undefined)) {
    problems.push("Map either full_name or first_name and last_name, not both.");
  } else if (!hasSplitName && full_name === undefined) {
    problems.push("A name is required: map full_name, or both first_name and last_name.");
  }
  if (full_name !== undefined && mapping.fullNameFormat === undefined) {
    problems.push("full_name needs a format: last_comma_first or first_last.");
  }
  return problems;
}

function splitFullName(text: string, format: FullNameFormat): { first: string; last: string } | null {
  if (format === "last_comma_first") {
    const comma = text.indexOf(",");
    if (comma < 0) return null;
    const last = text.slice(0, comma).trim();
    const first = text.slice(comma + 1).trim();
    return last === "" || first === "" ? null : { first, last };
  }
  const space = text.lastIndexOf(" ");
  if (space < 0) return null;
  return { first: text.slice(0, space), last: text.slice(space + 1) };
}

/**
 * Convert CSV rows to source records with normalized fields. Invalid values are
 * left out of the record and reported as warnings, never silently dropped.
 * Call validateMapping first.
 */
export function applyMapping(
  label: string,
  table: CsvTable,
  mapping: ColumnMapping,
): { records: SourceRecord[]; warnings: ValidationWarning[] } {
  const records: SourceRecord[] = [];
  const warnings: ValidationWarning[] = [];
  const cell = (row: string[], column: string | undefined) =>
    column === undefined ? "" : (row[table.headers.indexOf(column)] ?? "");

  for (const row of table.rows) {
    const ref = `${label}:${row.line}`;
    const record: SourceRecord = {
      ref,
      source: label,
      line: row.line,
      recordId: cleanText(cell(row.cells, mapping.columns.record_id)),
      fields: {},
    };

    const raws: Partial<Record<CanonicalField, string>> = {};
    for (const field of CANONICAL_FIELDS) {
      raws[field] = cell(row.cells, mapping.columns[field]);
    }

    const fullNameColumn = mapping.columns.full_name;
    if (fullNameColumn !== undefined && mapping.fullNameFormat !== undefined) {
      const raw = cell(row.cells, fullNameColumn);
      const text = cleanText(raw);
      if (text !== null) {
        const parts = splitFullName(text, mapping.fullNameFormat);
        if (parts === null) {
          warnings.push({
            ref,
            field: "full_name",
            raw,
            message: `could not split into first and last name using format ${mapping.fullNameFormat}`,
          });
        } else {
          raws.first_name = parts.first;
          raws.last_name = parts.last;
        }
      }
    }

    for (const field of CANONICAL_FIELDS) {
      const raw = raws[field] ?? "";
      const normalized = normalizeField(field, raw);
      if (normalized === null) continue;
      if (normalized.ok) {
        const provenanceRaw = fullNameColumn !== undefined && (field === "first_name" || field === "last_name")
          ? cell(row.cells, fullNameColumn)
          : raw;
        record.fields[field] = { value: normalized.value, key: normalized.key, raw: provenanceRaw };
      } else {
        warnings.push({ ref, field, raw, message: normalized.reason });
      }
    }

    if (Object.keys(record.fields).length === 0) {
      warnings.push({ ref, field: "row", raw: row.cells.join(","), message: "row has no usable values and was skipped" });
      continue;
    }
    if (record.fields.last_name === undefined) {
      warnings.push({ ref, field: "row", raw: row.cells.join(","), message: "row has no last name, so it can only match by email or phone" });
    }
    records.push(record);
  }
  return { records, warnings };
}

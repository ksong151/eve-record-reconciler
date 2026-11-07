// The canonical member schema every source CSV is mapped into.
// See README.md "Canonical schema" for the documented version of this table.

export const CANONICAL_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "graduation_year",
  "city",
  "status",
  "notes",
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

/**
 * Mapping targets are the canonical fields plus two source-only columns:
 * `full_name` (split into first and last name) and `record_id` (the source's
 * own row identifier, kept for provenance and never merged).
 */
export const MAPPING_TARGETS = [...CANONICAL_FIELDS, "full_name", "record_id"] as const;

export type MappingTarget = (typeof MAPPING_TARGETS)[number];

export type FullNameFormat = "last_comma_first" | "first_last";

/**
 * `notes` keeps every distinct value from every source. All other fields hold
 * one value, and disagreeing values become a conflict for review.
 */
export function isMultiValueField(field: CanonicalField): boolean {
  return field === "notes";
}

/**
 * Header aliases used for automatic column detection. Headers are compared
 * after lowercasing and replacing every run of non-alphanumeric characters
 * with one space, so "Grad_Year", "grad-year" and "Grad Year" all become
 * "grad year". Each alias belongs to exactly one target.
 */
export const HEADER_ALIASES: Record<MappingTarget, readonly string[]> = {
  first_name: ["first name", "first", "given name", "forename"],
  last_name: ["last name", "last", "surname", "family name"],
  full_name: ["name", "full name", "member name"],
  email: ["email", "e mail", "email address", "e mail address"],
  phone: [
    "phone",
    "phone number",
    "telephone",
    "mobile",
    "mobile phone",
    "cell",
    "cell phone",
    "home phone",
    "work phone",
  ],
  graduation_year: ["graduation year", "grad year", "class year", "class", "year of graduation"],
  city: ["city", "town"],
  status: ["status", "membership status", "member status"],
  notes: ["notes", "note", "comments", "comment"],
  record_id: ["id", "member id", "member no", "member number", "record id"],
};

export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

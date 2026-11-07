// Deterministic field normalization. README.md "Normalization" documents
// these rules; keep the two in sync.

import type { CanonicalField } from "./schema.ts";

export type NormalizedValue =
  | { ok: true; value: string; key: string }
  | { ok: false; reason: string };

/** Unicode NFC, trim, and collapse every whitespace run to one space. Empty becomes null. */
export function cleanText(raw: string): string | null {
  const cleaned = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  return cleaned === "" ? null : cleaned;
}

/**
 * Comparison key for names and cities: strip accents, lowercase, and keep only
 * letters, digits, and single spaces. "García" and "garcia" share the key
 * "garcia"; "O'Neil" becomes "oneil".
 */
export function textKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/ +/g, " ")
    .trim();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(text: string): NormalizedValue {
  const email = text.toLowerCase();
  if (!EMAIL_PATTERN.test(email)) return { ok: false, reason: "not a valid email address" };
  return { ok: true, value: email, key: email };
}

/**
 * Phone numbers become E.164 strings. Spaces, dots, dashes, and parentheses are
 * ignored. A number starting with "+" keeps its country code (8 to 15 digits).
 * Otherwise the North American Numbering Plan is assumed: 10 digits get "+1",
 * and 11 digits starting with 1 get "+". Anything else, including extensions
 * and numbers without an area code, is invalid.
 */
function normalizePhone(text: string): NormalizedValue {
  if (/[^0-9+().\-\s]/.test(text) || text.lastIndexOf("+") > 0) {
    return { ok: false, reason: "contains characters other than digits, spaces, + ( ) . -" };
  }
  const digits = text.replace(/\D/g, "");
  let e164: string | null = null;
  if (text.startsWith("+")) {
    if (digits.length >= 8 && digits.length <= 15) e164 = `+${digits}`;
  } else if (digits.length === 10) {
    e164 = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    e164 = `+${digits}`;
  }
  if (e164 === null) {
    return { ok: false, reason: "not a 10-digit North American number or a +country-code number" };
  }
  return { ok: true, value: e164, key: e164 };
}

function normalizeYear(text: string): NormalizedValue {
  if (!/^\d{4}$/.test(text)) return { ok: false, reason: "not a four-digit year" };
  const year = Number(text);
  if (year < 1900 || year > 2100) return { ok: false, reason: "year outside 1900-2100" };
  return { ok: true, value: text, key: text };
}

/**
 * Normalize one raw cell for a canonical field. Returns null for an empty cell.
 */
export function normalizeField(field: CanonicalField, raw: string): NormalizedValue | null {
  const text = cleanText(raw);
  if (text === null) return null;

  switch (field) {
    case "first_name":
    case "last_name":
    case "city": {
      const key = textKey(text);
      if (key === "") return { ok: false, reason: "contains no letters or digits" };
      return { ok: true, value: text, key };
    }
    case "email":
      return normalizeEmail(text);
    case "phone":
      return normalizePhone(text);
    case "graduation_year":
      return normalizeYear(text);
    case "status": {
      const value = text.toLowerCase();
      return { ok: true, value, key: value };
    }
    case "notes":
      return { ok: true, value: text, key: text.toLowerCase() };
  }
}

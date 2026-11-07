import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeField, textKey } from "../agent/lib/normalize.ts";

const value = (field: Parameters<typeof normalizeField>[0], raw: string) => normalizeField(field, raw);

test("empty and whitespace-only cells are missing, not invalid", () => {
  assert.equal(value("email", ""), null);
  assert.equal(value("phone", "   "), null);
});

test("names keep their spelling but compare without case, accents, or punctuation", () => {
  assert.deepEqual(value("last_name", "  García  "), { ok: true, value: "García", key: "garcia" });
  assert.equal(textKey("O'Neil"), "oneil");
  assert.equal(textKey("Mary  Ann"), "mary ann");
  assert.deepEqual(value("first_name", "--"), { ok: false, reason: "contains no letters or digits" });
});

test("emails are lowercased and checked for a basic address shape", () => {
  assert.deepEqual(value("email", " Morgan.Ellis@Example.COM "), {
    ok: true,
    value: "morgan.ellis@example.com",
    key: "morgan.ellis@example.com",
  });
  assert.equal(value("email", "not-an-email")?.ok, false);
});

test("phones become E.164, assuming North America without a country code", () => {
  for (const raw of ["(312) 555-0101", "312.555.0101", "+1 312 555 0101", "1-312-555-0101"]) {
    assert.deepEqual(value("phone", raw), { ok: true, value: "+13125550101", key: "+13125550101" });
  }
  assert.deepEqual(value("phone", "+44 20 7946 0958"), { ok: true, value: "+442079460958", key: "+442079460958" });
  assert.equal(value("phone", "555-0150")?.ok, false, "no area code");
  assert.equal(value("phone", "312-555-0101 x12")?.ok, false, "extension");
});

test("graduation years must be four digits between 1900 and 2100", () => {
  assert.deepEqual(value("graduation_year", " 2015 "), { ok: true, value: "2015", key: "2015" });
  assert.equal(value("graduation_year", "'15")?.ok, false);
  assert.equal(value("graduation_year", "1850")?.ok, false);
});

test("status is lowercased; notes keep their text", () => {
  assert.deepEqual(value("status", "Active"), { ok: true, value: "active", key: "active" });
  assert.deepEqual(value("notes", "Moved  to Chicago, IL"), {
    ok: true,
    value: "Moved to Chicago, IL",
    key: "moved to chicago, il",
  });
});

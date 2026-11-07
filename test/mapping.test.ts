import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv } from "../agent/lib/csv.ts";
import { applyMapping, detectMapping, validateMapping } from "../agent/lib/mapping.ts";

test("detects columns from header aliases regardless of case and punctuation", () => {
  const { mapping, pendingChoices } = detectMapping(
    parseCsv("Member-ID,Given Name,SURNAME,E-mail,Cell,Grad_Year,Town,Comments\n"),
  );
  assert.deepEqual(pendingChoices, []);
  assert.deepEqual(mapping.columns, {
    record_id: "Member-ID",
    first_name: "Given Name",
    last_name: "SURNAME",
    email: "E-mail",
    phone: "Cell",
    graduation_year: "Grad_Year",
    city: "Town",
    notes: "Comments",
  });
});

test("two candidate columns for one field become a pending question", () => {
  const detection = detectMapping(parseCsv("first_name,last_name,mobile_phone,work_phone\n"));
  assert.equal(detection.mapping.columns.phone, undefined);
  assert.deepEqual(detection.pendingChoices.map((c) => [c.target, c.candidates]), [
    ["phone", ["mobile_phone", "work_phone"]],
  ]);
});

test("full name format: all commas means Last, First; none means First Last; mixed asks", () => {
  const lastFirst = detectMapping(parseCsv('Name\n"Ellis, Morgan"\n"Lee, Jordan"\n'));
  assert.equal(lastFirst.mapping.fullNameFormat, "last_comma_first");
  const firstLast = detectMapping(parseCsv("Name\nMorgan Ellis\n"));
  assert.equal(firstLast.mapping.fullNameFormat, "first_last");
  const mixed = detectMapping(parseCsv('Name\n"Ellis, Morgan"\nJordan Lee\n'));
  assert.equal(mixed.mapping.fullNameFormat, undefined);
  assert.equal(mixed.pendingChoices[0]?.target, "full_name");
});

test("validateMapping requires a name and catches bad columns", () => {
  const headers = ["email", "phone"];
  assert.deepEqual(validateMapping({ columns: { email: "email" } }, headers), [
    "A name is required: map full_name, or both first_name and last_name.",
  ]);
  const problems = validateMapping(
    { columns: { first_name: "email", last_name: "email", phone: "fax" } },
    headers,
  );
  assert.ok(problems.includes('"email" is mapped to both first_name and last_name.'));
  assert.ok(problems.includes('phone is mapped to "fax", which is not a column in this file.'));
});

test("applyMapping splits names, normalizes values, and reports invalid cells as warnings", () => {
  const table = parseCsv('Name,Phone,Class Year\n"Ellis, Morgan",312-555-0101,2012\nQuinn,555-0150,20l7\n');
  const detection = detectMapping(table);
  assert.equal(detection.pendingChoices[0]?.target, "full_name", "one name has no comma, so the format is asked");
  const mapping = { ...detection.mapping, fullNameFormat: "last_comma_first" as const };
  const { records, warnings } = applyMapping("legacy", table, mapping);

  assert.equal(records[0]?.ref, "legacy:2");
  assert.equal(records[0]?.fields.first_name?.value, "Morgan");
  assert.equal(records[0]?.fields.last_name?.raw, "Ellis, Morgan");
  assert.equal(records[0]?.fields.phone?.value, "+13125550101");

  assert.deepEqual(
    warnings.map((w) => [w.ref, w.field, w.raw]),
    [
      ["legacy:3", "full_name", "Quinn"],
      ["legacy:3", "phone", "555-0150"],
      ["legacy:3", "graduation_year", "20l7"],
      ["legacy:3", "row", "Quinn,555-0150,20l7"],
    ],
  );
  assert.equal(records.length, 1, "a row with no usable values is skipped and reported");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { CsvError, parseCsv, toCsv } from "../agent/lib/csv.ts";

test("parses quoted commas, escaped quotes, empty fields, and CRLF", () => {
  const table = parseCsv('name,notes,year\r\n"Ellis, Morgan","Said ""hi""",\r\n"",,2012\r\n');
  assert.deepEqual(table.headers, ["name", "notes", "year"]);
  assert.deepEqual(table.rows, [
    { line: 2, cells: ["Ellis, Morgan", 'Said "hi"', ""] },
    { line: 3, cells: ["", "", "2012"] },
  ]);
});

test("keeps line breaks inside quoted fields and reports the starting line", () => {
  const table = parseCsv('a,b\n"line one\nline two",x\ny,z\n');
  assert.deepEqual(table.rows[0], { line: 2, cells: ["line one\nline two", "x"] });
  assert.deepEqual(table.rows[1], { line: 4, cells: ["y", "z"] });
});

test("ignores a byte order mark, blank lines, and a missing final newline", () => {
  const table = parseCsv("﻿a,b\n\n1,2");
  assert.deepEqual(table.headers, ["a", "b"]);
  assert.deepEqual(table.rows, [{ line: 3, cells: ["1", "2"] }]);
});

function issues(text: string): string[] {
  try {
    parseCsv(text);
  } catch (error) {
    assert.ok(error instanceof CsvError);
    return error.issues.map((i) => `${i.line}: ${i.message}`);
  }
  assert.fail("expected a CsvError");
}

test("rejects rows with the wrong number of columns, listing every bad line", () => {
  assert.deepEqual(issues("a,b\n1,2,3\n4\n5,6\n"), [
    "2: expected 2 columns but found 3",
    "3: expected 2 columns but found 1",
  ]);
});

test("rejects unterminated and stray quotes", () => {
  assert.deepEqual(issues('a,b\n"open,1\n'), ['2: quoted field is never closed']);
  assert.deepEqual(issues('a,b\nab"c,1\n'), ["2: double quote inside an unquoted field"]);
  assert.deepEqual(issues('a,b\n"x"y,1\n'), ["2: unexpected character after a closing quote"]);
});

test("rejects empty and duplicate headers, and empty files", () => {
  assert.deepEqual(issues("a,,A\n1,2,3\n"), [
    "1: header in column 2 is empty",
    '1: header "A" in column 3 duplicates column 1',
  ]);
  assert.deepEqual(issues(""), ["1: file has no header row"]);
});

test("writes CSV that round-trips through the parser", () => {
  const rows = [["Ellis, Morgan", 'said "hi"', " padded", "multi\nline", ""]];
  const text = toCsv(["a", "b", "c", "d", "e"], rows);
  assert.deepEqual(parseCsv(text).rows[0]?.cells, rows[0]);
});

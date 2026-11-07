// Minimal RFC 4180 CSV reader and writer.
//
// Reading rules:
// - Fields are separated by commas; records end with LF or CRLF.
// - A field that starts with a double quote is quoted. Inside it, commas and
//   line breaks are literal and `""` stands for one `"`.
// - A UTF-8 byte order mark at the start of the file is ignored.
// - Completely empty lines are skipped.
// - The first record is the header row.
// Structural problems (unterminated quotes, stray quotes, rows with the wrong
// number of columns, empty or duplicate headers) are collected and thrown
// together as a CsvError, so a malformed file is never partially loaded.

export interface CsvRow {
  /** 1-based line number where the record starts in the file. */
  line: number;
  cells: string[];
}

export interface CsvTable {
  headers: string[];
  rows: CsvRow[];
}

export interface CsvIssue {
  line: number;
  message: string;
}

export class CsvError extends Error {
  readonly issues: CsvIssue[];

  constructor(issues: CsvIssue[]) {
    const shown = issues
      .slice(0, 20)
      .map((issue) => `line ${issue.line}: ${issue.message}`)
      .join("; ");
    const more = issues.length > 20 ? ` (and ${issues.length - 20} more)` : "";
    super(`Invalid CSV: ${shown}${more}`);
    this.name = "CsvError";
    this.issues = issues;
  }
}

function tokenize(text: string, issues: CsvIssue[]): CsvRow[] {
  const rows: CsvRow[] = [];
  let line = 1;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  while (i < text.length) {
    const startLine = line;
    const cells: string[] = [];
    let atRecordEnd = false;

    while (!atRecordEnd) {
      let cell = "";
      if (text[i] === '"') {
        const quoteLine = line;
        i++;
        let closed = false;
        while (i < text.length) {
          const ch = text[i];
          if (ch === '"') {
            if (text[i + 1] === '"') {
              cell += '"';
              i += 2;
              continue;
            }
            i++;
            closed = true;
            break;
          }
          if (ch === "\n") line++;
          cell += ch;
          i++;
        }
        if (!closed) {
          issues.push({ line: quoteLine, message: "quoted field is never closed" });
          return rows;
        }
        const next = text[i];
        if (next !== undefined && next !== "," && next !== "\n" && next !== "\r") {
          issues.push({ line, message: "unexpected character after a closing quote" });
          while (i < text.length && text[i] !== "," && text[i] !== "\n") i++;
        }
      } else {
        while (i < text.length && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") {
          if (text[i] === '"') {
            issues.push({ line, message: "double quote inside an unquoted field" });
          }
          cell += text[i];
          i++;
        }
      }
      cells.push(cell);

      if (text[i] === ",") {
        i++;
      } else {
        if (text[i] === "\r") i++;
        if (text[i] === "\n") {
          i++;
          line++;
        } else if (i < text.length) {
          issues.push({ line, message: "carriage return without a line feed" });
          i++;
        }
        atRecordEnd = true;
      }
    }

    const isBlankLine = cells.length === 1 && cells[0] === "";
    if (!isBlankLine) rows.push({ line: startLine, cells });
  }
  return rows;
}

export function parseCsv(text: string): CsvTable {
  const issues: CsvIssue[] = [];
  const records = tokenize(text, issues);
  if (issues.length > 0) throw new CsvError(issues);

  const headerRow = records[0];
  if (headerRow === undefined) {
    throw new CsvError([{ line: 1, message: "file has no header row" }]);
  }

  const headers = headerRow.cells.map((h) => h.trim());
  const seen = new Map<string, number>();
  headers.forEach((header, index) => {
    if (header === "") {
      issues.push({ line: headerRow.line, message: `header in column ${index + 1} is empty` });
      return;
    }
    const folded = header.toLowerCase();
    const first = seen.get(folded);
    if (first !== undefined) {
      issues.push({
        line: headerRow.line,
        message: `header "${header}" in column ${index + 1} duplicates column ${first + 1}`,
      });
    } else {
      seen.set(folded, index);
    }
  });

  const rows = records.slice(1);
  for (const row of rows) {
    if (row.cells.length !== headers.length) {
      issues.push({
        line: row.line,
        message: `expected ${headers.length} columns but found ${row.cells.length}`,
      });
    }
  }
  if (issues.length > 0) throw new CsvError(issues);

  return { headers, rows };
}

function quoteCell(value: string): string {
  return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [headers, ...rows].map((row) => row.map(quoteCell).join(",")).join("\r\n") + "\r\n";
}

// File access policy. The agent reads only CSV files the user names (files
// outside mock-data/ need human approval in load_sources) and writes only in
// an output directory the user approves in export_reconciliation.

import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export const MAX_INPUT_BYTES = 10 * 1024 * 1024;

export function mockDataDir(cwd: string = process.cwd()): string {
  return path.resolve(cwd, "mock-data");
}

export function isInside(child: string, dir: string): boolean {
  const relative = path.relative(dir, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function realpathOr(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return p;
  }
}

/** True when the path, after resolving symlinks, is inside the bundled mock-data folder. */
export async function isInMockData(p: string, cwd: string = process.cwd()): Promise<boolean> {
  const dir = await realpathOr(mockDataDir(cwd));
  const target = await realpathOr(path.resolve(cwd, p));
  return isInside(target, dir);
}

/** Resolve an input path to a real path and check it is a readable-size .csv file. */
export async function resolveInputCsv(p: string, cwd: string = process.cwd()): Promise<string> {
  const absolute = path.resolve(cwd, p);
  if (path.extname(absolute).toLowerCase() !== ".csv") {
    throw new Error(`${p}: only .csv files can be loaded.`);
  }
  let real: string;
  try {
    real = await realpath(absolute);
  } catch {
    throw new Error(`${p}: file not found.`);
  }
  const info = await stat(real);
  if (!info.isFile()) throw new Error(`${p}: not a regular file.`);
  if (info.size > MAX_INPUT_BYTES) {
    throw new Error(`${p}: file is larger than ${MAX_INPUT_BYTES / 1024 / 1024} MB.`);
  }
  return real;
}

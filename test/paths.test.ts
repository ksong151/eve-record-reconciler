import assert from "node:assert/strict";
import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { isInMockData, resolveInputCsv } from "../agent/lib/paths.ts";
import { tempDir } from "./helpers.ts";

// Fictional record only.
const CSV = "first_name,last_name,phone\nMorgan,Ellis,312-555-0101\n";

/** A throwaway project root: mock-data/demo.csv, a private file outside it, and two symlinks. */
async function projectRoot(): Promise<string> {
  const root = await realpath(await tempDir());
  await mkdir(path.join(root, "mock-data"));
  await writeFile(path.join(root, "mock-data", "demo.csv"), CSV);
  await writeFile(path.join(root, "private.txt"), CSV);
  await symlink(path.join(root, "private.txt"), path.join(root, "mock-data", "escape.csv"));
  await symlink(path.join(root, "mock-data", "demo.csv"), path.join(root, "alias.csv"));
  return root;
}

test("isInMockData follows symlinks and parent traversal, so only real mock-data files skip approval", async () => {
  const root = await projectRoot();
  assert.equal(await isInMockData("mock-data/demo.csv", root), true);
  assert.equal(await isInMockData(path.join(root, "mock-data", "demo.csv"), root), true, "absolute path to the same file");
  assert.equal(await isInMockData("mock-data/escape.csv", root), false, "symlink inside mock-data that points outside");
  assert.equal(await isInMockData("mock-data/../private.txt", root), false, "parent traversal");
  assert.equal(await isInMockData("mock-data", root), false, "the folder itself");
  assert.equal(await isInMockData("alias.csv", root), true, "symlink outside that points into mock-data");
});

test("resolveInputCsv checks the .csv extension on the resolved file, not just the name given", async () => {
  const root = await projectRoot();
  assert.equal(await resolveInputCsv("mock-data/demo.csv", root), path.join(root, "mock-data", "demo.csv"));
  assert.equal(await resolveInputCsv("alias.csv", root), path.join(root, "mock-data", "demo.csv"), "a symlink to a .csv file is fine");
  await assert.rejects(resolveInputCsv("mock-data/escape.csv", root), /not a \.csv file/, "a .csv name that resolves to private.txt");
  await assert.rejects(resolveInputCsv("private.txt", root), /only \.csv files/);
  await mkdir(path.join(root, "folder.csv"));
  await assert.rejects(resolveInputCsv("folder.csv", root), /not a regular file/);
  await assert.rejects(resolveInputCsv("missing.csv", root), /file not found/);
});

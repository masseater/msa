import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vite-plus/test";

import { db } from "../src/core/orchestrator/db.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

it("creates the database and its missing parent directories", () => {
  const root = mkdtempSync(join(tmpdir(), "msa-orchestrator-open-"));
  directories.push(root);
  const path = join(root, "agent", "nested", "orchestrator.db");

  const database = db.openDatabase(path);
  database.close();

  expect(existsSync(path)).toBe(true);
});

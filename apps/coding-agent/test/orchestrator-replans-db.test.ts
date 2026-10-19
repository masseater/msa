import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, expect, it } from "vite-plus/test";

import { db } from "../src/core/orchestrator/db.ts";
import { replanStore } from "../src/core/orchestrator/replan-store.ts";

const directories: string[] = [];

const emptyChanges = { stopped: [], created: [], dropped: [], kept: [], rewired: [] };

function legacyDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "msa-orchestrator-"));
  directories.push(directory);
  const path = join(directory, "orchestrator.db");
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE replans (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      reason TEXT NOT NULL,
      before_state TEXT NOT NULL,
      after_state TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      undone_at INTEGER
    );
    CREATE INDEX replans_project ON replans(project, created_at);
  `);
  legacy
    .prepare(
      "INSERT INTO replans (id, project, reason, before_state, after_state, created_at, undone_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run("rp-1", "p", "the api moved", "{}", JSON.stringify(emptyChanges), 1, null);
  legacy.close();
  return path;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("keeps the replan history of an existing database and drops the undo columns", () => {
  const database = db.openDatabase(legacyDatabase());
  const columns = (database.prepare("PRAGMA table_info(replans)").all() as { name: string }[]).map(
    (column) => column.name,
  );
  expect(columns).not.toContain("before_state");
  expect(columns).not.toContain("undone_at");
  expect(replanStore.listReplans(database, "p", 10).map((view) => view.id)).toEqual(["rp-1"]);

  replanStore.insertReplan(database, {
    id: "rp-2",
    project: "p",
    reason: "split the work",
    after: emptyChanges,
    createdAt: 2,
  });
  expect(replanStore.listReplans(database, "p", 10).map((view) => view.id)).toEqual([
    "rp-2",
    "rp-1",
  ]);
  database.close();
});

it("opens a database that never had the undo columns", () => {
  const directory = mkdtempSync(join(tmpdir(), "msa-orchestrator-"));
  directories.push(directory);
  const path = join(directory, "orchestrator.db");
  db.openDatabase(path).close();
  const database = db.openDatabase(path);
  expect(replanStore.listReplans(database, "p", 10)).toEqual([]);
  database.close();
});

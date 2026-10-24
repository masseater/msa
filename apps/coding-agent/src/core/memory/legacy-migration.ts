import * as Effect from "effect/Effect";

import pathsModule from "../../utils/paths.ts";
import awaitingModule from "../awaiting.ts";
import directoryLock from "../directory-lock.ts";
import platform from "../platform/index.ts";
import DatabaseSync from "../platform/node/sqlite.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";
import memoryRequests from "./memory-requests.ts";
import type memoryTypes from "./memory.types.ts";
import secretCheckLazy from "./secret-check.lazy.ts";

const { awaited, awaiting } = awaitingModule;
const { join } = platform;
const { resolvePath } = pathsModule;
const { exists, remove, rename } = platform.files;
const { migrationRequests } = memoryRequests;
const { findSecrets } = secretCheckLazy;
const { withDirectoryLock } = directoryLock;

const LEGACY_DATABASE = "memory.db";
const MIGRATED_SUFFIX = ".migrated";

interface LegacyRow {
  id: string;
  content: string;
  scope: string;
  project: string | null;
}

function legacyDatabasePath(agentDir: string, settings: settingsManagerTypes.Settings): string {
  const configured = (settings.memory as { database?: unknown } | undefined)?.database;
  return typeof configured === "string" && configured.trim() !== ""
    ? resolvePath(configured.trim(), agentDir)
    : join(agentDir, LEGACY_DATABASE);
}

function readPending(database: DatabaseSync): LegacyRow[] {
  const table = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memories'")
    .get();
  if (table === undefined) return [];
  database.exec("CREATE TABLE IF NOT EXISTS sepiace_migrated (id TEXT PRIMARY KEY)");
  return database
    .prepare(
      `SELECT id, content, scope, project FROM memories
       WHERE id NOT IN (SELECT id FROM sepiace_migrated)
       ORDER BY created_at, id`,
    )
    .all() as unknown as LegacyRow[];
}

function readSent(database: DatabaseSync): Set<string> {
  database.exec("CREATE TABLE IF NOT EXISTS sepiace_migrated (id TEXT PRIMARY KEY)");
  const rows = database.prepare("SELECT id FROM sepiace_migrated").all() as unknown as {
    id: string;
  }[];
  return new Set(rows.map((row) => row.id));
}

function markMigrated(database: DatabaseSync, ids: readonly string[]): void {
  const insert = database.prepare("INSERT OR IGNORE INTO sepiace_migrated (id) VALUES (?)");
  for (const id of ids) insert.run(id);
}

function retire(path: string): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      yield* awaited(rename({ from: path, to: `${path}${MIGRATED_SUFFIX}` }));
      for (const suffix of ["-wal", "-shm"])
        yield* awaited(remove({ force: true, path: `${path}${suffix}` }));
    }),
  );
}

function migrateLegacyMemories(
  agentDir: string,
  path: string,
  send: (request: string) => Promise<unknown>,
): Promise<memoryTypes.MigrationResult | undefined> {
  return withDirectoryLock(agentDir, "memory-migration", () =>
    Effect.runPromise(
      awaiting(function* () {
        if (!(yield* awaited(exists(path)))) return undefined;
        const database = new DatabaseSync(path, { timeout: 5_000 });
        const skipped: { id: string; secrets: readonly string[] }[] = [];
        let sent = 0;
        try {
          const pending = readPending(database);
          const clean: LegacyRow[] = [];
          for (const row of pending) {
            const secrets = yield* awaited(findSecrets(row.content));
            if (secrets.length === 0) clean.push(row);
            else skipped.push({ id: row.id, secrets });
          }
          for (const batch of migrationRequests(clean, readSent(database))) {
            yield* awaited(send(batch.request));
            markMigrated(database, batch.done);
            sent += batch.memories;
          }
          database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        } finally {
          database.close();
        }
        yield* awaited(retire(path));
        return { sent, skipped };
      }),
    ),
  );
}

const legacyMigration = { legacyDatabasePath, migrateLegacyMemories };

export default legacyMigration;

import { DatabaseSync } from "node:sqlite";

import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";
import { dual } from "effect/Function";

import sqlite from "../src/storage/sqlite/index.ts";
import type sqliteTypes from "../src/storage/sqlite/index.types.ts";
import node from "../src/storage/sqlite/node.ts";
import types from "../src/types.ts";
import type typesModule from "../src/types.types.ts";
import testSupport from "./support.ts";

const { openNodeSqliteStorage } = node;
const { ROOT_CONVERSATION_ID } = types;
const { SqliteStorage: SqliteStorageModule } = sqlite;

const { awaited } = testSupport;
const { joinPath, makeTempDir } = testSupport;

const context = testSupport.BACKGROUND_CONTEXT;

const openStorages = new Set<sqliteTypes.SqliteStorage>();

const tempDirectories = new Set<string>();

const createSqliteStorage = Effect.fn("createSqliteStorage")(function* (
  options: { readonly walAutoCheckpointPages?: number } = {},
) {
  const directory = yield* makeTempDir("msa-durable-sqlite-");
  tempDirectories.add(directory);
  const path = joinPath(directory, "storage.sqlite");
  const storage = yield* awaited(openNodeSqliteStorage(path, options));
  openStorages.add(storage);
  return { path, storage };
});

function entryImpl(
  id: typesModule.EntryId,
  conversationId: typesModule.ConversationId,
  data: chordTypes.JsonValue | undefined,
): typesModule.EntryRecord {
  return { conversationId, id, kind: "message", ...(data === undefined ? {} : { data }) };
}

const entry: {
  (
    conversationId: typesModule.ConversationId,
    data: chordTypes.JsonValue | undefined,
  ): (id: typesModule.EntryId) => ReturnType<typeof entryImpl>;
  (
    id: typesModule.EntryId,
    conversationId: typesModule.ConversationId,
    data: chordTypes.JsonValue | undefined,
  ): ReturnType<typeof entryImpl>;
} = dual(3, entryImpl);

function createRoot(storage: typesModule.Storage): Promise<typesModule.Seq> {
  return Promise.resolve(
    storage.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], context),
  );
}

function pendingTask(
  id: typesModule.TaskId<chordTypes.JsonValue>,
): typesModule.TaskRecord<chordTypes.JsonValue, chordTypes.JsonValue, chordTypes.JsonValue> {
  return {
    abortRequested: false,
    background: false,
    conversationId: ROOT_CONVERSATION_ID,
    id,
    input: null,
    kind: "test.task",
    state: { checkpoint: { phase: "ready" }, status: "pending" },
    version: 1,
  };
}

function scalarImpl(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as { readonly value: number };
  return row.value;
}

const scalar: {
  (sql: string): (db: DatabaseSync) => ReturnType<typeof scalarImpl>;
  (db: DatabaseSync, sql: string): ReturnType<typeof scalarImpl>;
} = dual(2, scalarImpl);

const sqliteStorageSupport = {
  SqliteStorage: SqliteStorageModule,
  context,
  createRoot,
  createSqliteStorage,
  entry,
  openNodeSqliteStorage,
  openStorages,
  pendingTask,
  scalar,
  tempDirectories,
};

export default sqliteStorageSupport;

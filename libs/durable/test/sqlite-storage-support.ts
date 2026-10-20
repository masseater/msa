import { DatabaseSync } from "node:sqlite";

import type { JsonValue } from "@msa/chord";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type { SqliteStorage } from "../src/storage/sqlite/index.ts";
import { SqliteStorage as SqliteStorageModule } from "../src/storage/sqlite/index.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import type {
  ConversationId,
  EntryId,
  EntryRecord,
  Seq,
  Storage,
  TaskId,
  TaskRecord,
} from "../src/types.ts";
import { ROOT_CONVERSATION_ID } from "../src/types.ts";
import effectSupport from "./effect-support.ts";
import platformSupport from "./platform-support.ts";

const { awaited } = effectSupport;
const { joinPath, makeTempDir } = platformSupport;

const context = BACKGROUND_CONTEXT;

const openStorages = new Set<SqliteStorage>();

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
  id: EntryId,
  conversationId: ConversationId,
  data: JsonValue | undefined,
): EntryRecord {
  return { conversationId, id, kind: "message", ...(data === undefined ? {} : { data }) };
}

const entry: {
  (
    conversationId: ConversationId,
    data: JsonValue | undefined,
  ): (id: EntryId) => ReturnType<typeof entryImpl>;
  (
    id: EntryId,
    conversationId: ConversationId,
    data: JsonValue | undefined,
  ): ReturnType<typeof entryImpl>;
} = dual(3, entryImpl);

function createRoot(storage: Storage): Promise<Seq> {
  return Promise.resolve(
    storage.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], context),
  );
}

function pendingTask(id: TaskId<JsonValue>): TaskRecord<JsonValue, JsonValue, JsonValue> {
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

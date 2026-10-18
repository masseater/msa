import { DatabaseSync } from "node:sqlite";

import type { JsonValue } from "@msa/chord";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type { SqliteStorage } from "../src/storage/sqlite/index.ts";
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
import { awaited } from "./effect-support.ts";
import { joinPath, makeTempDir } from "./platform-support.ts";

export const context = BACKGROUND_CONTEXT;

export const openStorages = new Set<SqliteStorage>();

export const tempDirectories = new Set<string>();

export const createSqliteStorage = Effect.fn("createSqliteStorage")(function* (
  options: { readonly walAutoCheckpointPages?: number } = {},
) {
  const directory = yield* makeTempDir("msa-durable-sqlite-");
  tempDirectories.add(directory);
  const path = joinPath(directory, "storage.sqlite");
  const storage = yield* awaited(openNodeSqliteStorage(path, options));
  openStorages.add(storage);
  return { storage, path };
});

function entryImpl(
  id: EntryId,
  conversationId: ConversationId,
  data: JsonValue | undefined,
): EntryRecord {
  return { id, conversationId, kind: "message", ...(data === undefined ? {} : { data }) };
}

export const entry: {
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

export function createRoot(storage: Storage): Promise<Seq> {
  return Promise.resolve(
    storage.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], context),
  );
}

export function pendingTask(id: TaskId<JsonValue>): TaskRecord<JsonValue, JsonValue, JsonValue> {
  return {
    id,
    conversationId: ROOT_CONVERSATION_ID,
    kind: "test.task",
    version: 1,
    input: null,
    state: { status: "pending", checkpoint: { phase: "ready" } },
    background: false,
    abortRequested: false,
  };
}

function scalarImpl(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as { readonly value: number };
  return row.value;
}

export const scalar: {
  (sql: string): (db: DatabaseSync) => ReturnType<typeof scalarImpl>;
  (db: DatabaseSync, sql: string): ReturnType<typeof scalarImpl>;
} = dual(2, scalarImpl);

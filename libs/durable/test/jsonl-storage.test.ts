import { readFile, stat } from "node:fs/promises";

import type { JsonValue } from "@msa/chord";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeJsonlStorage } from "../src/storage/jsonl/node.ts";
import type { DocumentId, EntryId, TaskId } from "../src/types.ts";
import { ROOT_CONVERSATION_ID } from "../src/types.ts";
import { awaited } from "./effect-support.ts";
import {
  fileExists,
  terminalTask,
  readLines,
  sessionDocument,
  pendingTask,
  createRoot,
  context,
  openStorage,
  openStorages,
  tempDirectories,
  tempDirectory,
  InstrumentedEnv,
} from "./jsonl-storage-support.ts";
import { joinPath, removeDir } from "./platform-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const storage of openStorages) yield* awaited(storage.close(context));
      openStorages.clear();
      for (const directory of tempDirectories) yield* removeDir(directory);
      tempDirectories.clear();
    }),
  ),
);

const sidecarsBeforeReclamation = Effect.fn("sidecarsBeforeReclamation")(function* () {
  const directory = yield* tempDirectory();
  const storage = yield* openStorage(directory);
  yield* createRoot(storage);
  const taskId = yield* awaited(storage.mintId<TaskId<JsonValue>>());
  const documentId = yield* awaited(storage.mintId<DocumentId>());
  yield* awaited(storage.commit([{ type: "task", value: pendingTask(taskId) }], context));
  yield* awaited(
    storage.commit(
      [
        {
          type: "document.create",
          record: sessionDocument(documentId),
          content: { kind: "base", version: 1, value: { count: 0 } },
        },
      ],
      context,
    ),
  );
  yield* awaited(
    storage.commit(
      [
        {
          type: "document.change",
          id: documentId,
          content: { kind: "delta", version: 1, ops: [] },
        },
      ],
      context,
    ),
  );
  yield* awaited(
    storage.commit(
      [
        {
          type: "document.change",
          id: documentId,
          content: { kind: "base", version: 1, value: { count: 1 } },
        },
      ],
      context,
    ),
  );
  return { directory, storage, taskId, documentId };
});

const opensThroughNode = Effect.gen(function* () {
  const storage = yield* awaited(openNodeJsonlStorage(yield* tempDirectory(), context));
  openStorages.add(storage);
  yield* createRoot(storage);
  expect(yield* awaited(storage.conversation(ROOT_CONVERSATION_ID, context))).toEqual({
    id: ROOT_CONVERSATION_ID,
  });
});

const publishesEveryCommit = Effect.gen(function* () {
  const { directory, storage, taskId, documentId } = yield* sidecarsBeforeReclamation();
  expect(yield* readLines(joinPath(directory, `task-${taskId}.jsonl`))).toHaveLength(1);
  expect(yield* readLines(joinPath(directory, `doc-${documentId}.jsonl`))).toHaveLength(1);

  yield* awaited(storage.commit([{ type: "document.retire", id: documentId }], context));
  yield* awaited(storage.commit([{ type: "task", value: terminalTask(taskId) }], context));

  expect(yield* readLines(joinPath(directory, "main.jsonl"))).toHaveLength(7);
  expect(yield* fileExists(joinPath(directory, `task-${taskId}.jsonl`))).toBe(false);
  expect(yield* fileExists(joinPath(directory, `doc-${documentId}.jsonl`))).toBe(false);
  const markerTypes = (yield* readLines(joinPath(directory, "main.jsonl"))).map(
    (line) => (JSON.parse(line) as { readonly type: string }).type,
  );
  expect(markerTypes).toEqual([
    "commit",
    "commit",
    "commit",
    "commit",
    "commit",
    "commit",
    "commit",
  ]);
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("opens through the Node adapter", () => Effect.runPromise(opensThroughNode));

  it("publishes every commit before reclaiming current-only document and terminal-task sidecars", () =>
    Effect.runPromise(publishesEveryCommit));
});

const ordersMultipleLive = Effect.gen(function* () {
  const directory = yield* tempDirectory();
  const storage = yield* openStorage(directory);
  yield* createRoot(storage);
  const taskId = yield* awaited(storage.mintId<TaskId<JsonValue>>());
  yield* awaited(
    storage.commit(
      [
        { type: "task", value: pendingTask(taskId, "first") },
        { type: "task", value: pendingTask(taskId, "second") },
      ],
      context,
    ),
  );
  expect(yield* readLines(joinPath(directory, `task-${taskId}.jsonl`))).toHaveLength(2);

  const reopened = yield* openStorage(directory);
  expect(yield* awaited(reopened.task(taskId, context))).toEqual(pendingTask(taskId, "second"));
});

const removesCompletePlus = Effect.gen(function* () {
  const directory = yield* tempDirectory();
  const env = new InstrumentedEnv({ cwd: directory });
  const storage = yield* openStorage(directory, env);
  yield* createRoot(storage);
  const taskId = yield* awaited(storage.mintId<TaskId<JsonValue>>());
  env.fail({ operation: "append", call: 1, mode: "short" });
  yield* awaited(
    expect(
      storage.commit(
        [
          { type: "task", value: pendingTask(taskId, "first") },
          { type: "task", value: pendingTask(taskId, `second-${"x".repeat(512)}`) },
        ],
        context,
      ),
    ).rejects.toThrow("poisoned"),
  );
  const partial = yield* awaited(readFile(joinPath(directory, `task-${taskId}.jsonl`)));
  expect(partial.at(-1)).not.toBe(0x0a);
  expect([...partial].filter((byte) => byte === 0x0a)).toHaveLength(1);

  const reopened = yield* openStorage(directory);
  expect(yield* awaited(reopened.task(taskId, context))).toBeUndefined();
  expect((yield* awaited(stat(joinPath(directory, `task-${taskId}.jsonl`)))).size).toBe(0);
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("orders multiple live-task replacements in one sidecar by commit ordinal", () =>
    Effect.runPromise(ordersMultipleLive));

  it("removes a complete-plus-torn unconfirmed multi-record sidecar append", () =>
    Effect.runPromise(removesCompletePlus));
});

const serializesCompleteCandidate = Effect.gen(function* () {
  const directory = yield* tempDirectory();
  const env = new InstrumentedEnv({ cwd: directory });
  const storage = yield* openStorage(directory, env);
  yield* createRoot(storage);
  env.clear();
  const id = yield* awaited(storage.mintId<EntryId>());
  yield* awaited(
    expect(
      storage.commit(
        [
          {
            type: "entry",
            value: {
              id,
              conversationId: ROOT_CONVERSATION_ID,
              kind: "bad",
              data: 1n as unknown as JsonValue,
            },
          },
        ],
        context,
      ),
    ).rejects.toThrow(),
  );
  expect(env.operations).toEqual([]);
  expect(yield* awaited(storage.entry(id, context))).toBeUndefined();
  expect(
    yield* awaited(
      storage.commit(
        [
          {
            type: "entry",
            value: { id, conversationId: ROOT_CONVERSATION_ID, kind: "good" },
          },
        ],
        context,
      ),
    ),
  ).toBe(2);
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("serializes the complete candidate before I/O and leaves preparation failures usable", () =>
    Effect.runPromise(serializesCompleteCandidate));
});

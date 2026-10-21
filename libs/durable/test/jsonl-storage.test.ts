import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import node from "../src/storage/jsonl/node.ts";
import types from "../src/types.ts";
import type typesModule from "../src/types.types.ts";
import effectSupport from "./effect-support.ts";
import jsonlStorageSupport from "./jsonl-storage-support.ts";
import platformSupport from "./platform-support.ts";

const { openNodeJsonlStorage } = node;
const { ROOT_CONVERSATION_ID } = types;

const { awaited } = effectSupport;
const {
  InstrumentedEnv,
  context,
  createRoot,
  fileExists,
  openStorage,
  openStorages,
  pendingTask,
  readLines,
  sessionDocument,
  tempDirectories,
  tempDirectory,
  terminalTask,
} = jsonlStorageSupport;
const { fileSize, joinPath, readBytes, removeDir } = platformSupport;

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
  const taskId = yield* awaited(storage.mintId<typesModule.TaskId<chordTypes.JsonValue>>());
  const documentId = yield* awaited(storage.mintId<typesModule.DocumentId>());
  yield* awaited(storage.commit([{ type: "task", value: pendingTask(taskId) }], context));
  yield* awaited(
    storage.commit(
      [
        {
          content: { kind: "base", value: { count: 0 }, version: 1 },
          record: sessionDocument(documentId),
          type: "document.create",
        },
      ],
      context,
    ),
  );
  yield* awaited(
    storage.commit(
      [
        {
          content: { kind: "delta", ops: [], version: 1 },
          id: documentId,
          type: "document.change",
        },
      ],
      context,
    ),
  );
  yield* awaited(
    storage.commit(
      [
        {
          content: { kind: "base", value: { count: 1 }, version: 1 },
          id: documentId,
          type: "document.change",
        },
      ],
      context,
    ),
  );
  return { directory, documentId, storage, taskId };
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

  yield* awaited(storage.commit([{ id: documentId, type: "document.retire" }], context));
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
  const taskId = yield* awaited(storage.mintId<typesModule.TaskId<chordTypes.JsonValue>>());
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
  const taskId = yield* awaited(storage.mintId<typesModule.TaskId<chordTypes.JsonValue>>());
  env.fail({ call: 1, mode: "short", operation: "append" });
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
  const partial = yield* readBytes(joinPath(directory, `task-${taskId}.jsonl`));
  expect(partial.at(-1)).not.toBe(0x0a);
  expect([...partial].filter((byte) => byte === 0x0a)).toHaveLength(1);

  const reopened = yield* openStorage(directory);
  expect(yield* awaited(reopened.task(taskId, context))).toBeUndefined();
  expect(yield* fileSize(joinPath(directory, `task-${taskId}.jsonl`))).toBe(0);
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
  const id = yield* awaited(storage.mintId<typesModule.EntryId>());
  yield* awaited(
    expect(
      storage.commit(
        [
          {
            type: "entry",
            value: {
              conversationId: ROOT_CONVERSATION_ID,
              data: 1n as unknown as chordTypes.JsonValue,
              id,
              kind: "bad",
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
            value: { conversationId: ROOT_CONVERSATION_ID, id, kind: "good" },
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

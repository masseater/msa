import type { JsonValue } from "@msa/chord";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { DocumentId, EntryId, TaskId } from "../src/types.ts";
import { ROOT_CONVERSATION_ID } from "../src/types.ts";
import effectSupport from "./effect-support.ts";
import jsonlStorageSupport from "./jsonl-storage-support.ts";
import type jsonlStorageSupportTypes from "./jsonl-storage-support.types.ts";
import platformSupport from "./platform-support.ts";

const { awaited } = effectSupport;
const {
  InstrumentedEnv,
  context,
  createRoot,
  openStorage,
  openStorages,
  pendingTask,
  sessionDocument,
  tempDirectories,
  tempDirectory,
  terminalTask,
} = jsonlStorageSupport;
const { removeDir } = platformSupport;

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

const expectCreateFlushOrder = Effect.fn("expectCreateFlushOrder")(function* (fsync: boolean) {
  const directory = yield* tempDirectory();
  const env = new InstrumentedEnv({ cwd: directory });
  const storage = yield* openStorage(directory, env, { fsync });
  yield* createRoot(storage);
  const firstId = yield* awaited(storage.mintId<DocumentId>());
  const secondId = yield* awaited(storage.mintId<DocumentId>());
  env.clear();
  yield* awaited(
    storage.commit(
      [
        {
          content: { kind: "base", value: {}, version: 1 },
          record: sessionDocument(secondId, "second"),
          type: "document.create",
        },
        {
          content: { kind: "base", value: {}, version: 1 },
          record: sessionDocument(firstId, "first"),
          type: "document.create",
        },
      ],
      context,
    ),
  );
  const expected = [
    `append:doc-${secondId}.jsonl`,
    `append:doc-${firstId}.jsonl`,
    ...(fsync ? [`flush:doc-${secondId}.jsonl`, `flush:doc-${firstId}.jsonl`] : []),
    "append:main.jsonl",
  ];
  expect(env.operations).toEqual(expected);
  return { env, firstId, storage };
});

type FlushOrderStore = Effect.Success<ReturnType<typeof expectCreateFlushOrder>>;

const expectReclaimFlushOrder = Effect.fn("expectReclaimFlushOrder")(function* (
  { env, storage, firstId }: FlushOrderStore,
  fsync: boolean,
) {
  env.clear();
  yield* awaited(
    storage.commit(
      [
        {
          content: { kind: "base", value: { checkpoint: true }, version: 1 },
          id: firstId,
          type: "document.change",
        },
      ],
      context,
    ),
  );
  expect(env.operations).toEqual([
    `append:doc-${firstId}.jsonl`,
    ...(fsync ? [`flush:doc-${firstId}.jsonl`] : []),
    "append:main.jsonl",
    ...(fsync ? ["flush:main.jsonl"] : []),
    `write:doc-${firstId}.jsonl.reclaim`,
    ...(fsync ? [`flush:doc-${firstId}.jsonl.reclaim`] : []),
    `rename:doc-${firstId}.jsonl.reclaim->doc-${firstId}.jsonl`,
  ]);

  env.clear();
  yield* awaited(
    storage.commit(
      [
        {
          type: "entry",
          value: {
            conversationId: ROOT_CONVERSATION_ID,
            id: yield* awaited(storage.mintId<EntryId>()),
            kind: "main-only",
          },
        },
      ],
      context,
    ),
  );
  expect(env.operations).toEqual(["append:main.jsonl"]);
});

const expectTaskSidecarRemoval = Effect.fn("expectTaskSidecarRemoval")(function* (
  { env, storage }: FlushOrderStore,
  fsync: boolean,
) {
  const taskId = yield* awaited(storage.mintId<TaskId<JsonValue>>());
  yield* awaited(storage.commit([{ type: "task", value: pendingTask(taskId) }], context));
  env.clear();
  yield* awaited(storage.commit([{ type: "task", value: terminalTask(taskId) }], context));
  expect(env.operations).toEqual([
    "append:main.jsonl",
    ...(fsync ? ["flush:main.jsonl"] : []),
    `remove:task-${taskId}.jsonl`,
  ]);
});

const poisonsFailureAppendCases = [
  { call: 1, mode: "before", operation: "append" },
  { call: 1, mode: "after", operation: "append" },
  { call: 1, mode: "short", operation: "append" },
  { call: 2, mode: "before", operation: "append" },
  { call: 2, mode: "after", operation: "append" },
  { call: 3, mode: "before", operation: "append" },
  { call: 3, mode: "short", operation: "append" },
  { call: 3, mode: "after", operation: "append" },
] as const satisfies readonly jsonlStorageSupportTypes.Failure[];

const poisonsFailureAppend = Effect.fn("poisonsFailureAppend")(function* (
  failure: (typeof poisonsFailureAppendCases)[number],
) {
  const directory = yield* tempDirectory();
  const env = new InstrumentedEnv({ cwd: directory });
  const storage = yield* openStorage(directory, env);
  yield* createRoot(storage);
  const firstId = yield* awaited(storage.mintId<DocumentId>());
  const secondId = yield* awaited(storage.mintId<DocumentId>());
  env.fail(failure);
  yield* awaited(
    expect(
      storage.commit(
        [
          {
            content: { kind: "base", value: { text: "α" }, version: 1 },
            record: sessionDocument(firstId, "first"),
            type: "document.create",
          },
          {
            content: { kind: "base", value: { text: "β" }, version: 1 },
            record: sessionDocument(secondId, "second"),
            type: "document.create",
          },
        ],
        context,
      ),
    ).rejects.toThrow("poisoned"),
  );
  yield* awaited(expect(storage.document(firstId, "current", context)).rejects.toThrow("poisoned"));

  const reopened = yield* openStorage(directory);
  const markerSurvived = failure.call === 3 && failure.mode === "after";
  expect(yield* awaited(reopened.document(firstId, "current", context))).toEqual(
    markerSurvived ? expect.objectContaining({ value: { text: "α" } }) : undefined,
  );
  expect(yield* awaited(reopened.document(secondId, "current", context))).toEqual(
    markerSurvived ? expect.objectContaining({ value: { text: "β" } }) : undefined,
  );
});

describe("Pico JsonlStorage publication and recovery", () => {
  for (const failure of poisonsFailureAppendCases) {
    it(`poisons after ${failure.mode} failure at append ${failure.call} and recovers only confirmed state`, () =>
      Effect.runPromise(poisonsFailureAppend(failure)));
  }
});

const ordersPublicationFlushes = Effect.gen(function* () {
  for (const fsync of [false, true]) {
    const store = yield* expectCreateFlushOrder(fsync);
    yield* expectReclaimFlushOrder(store, fsync);
    yield* expectTaskSidecarRemoval(store, fsync);
  }
});

const poisonsFailureFlushCases = [
  { call: 1, mode: "before", operation: "flush" },
  { call: 1, mode: "after", operation: "flush" },
  { call: 2, mode: "before", operation: "flush" },
  { call: 2, mode: "after", operation: "flush" },
] as const satisfies readonly jsonlStorageSupportTypes.Failure[];

const poisonsFailureFlush = Effect.fn("poisonsFailureFlush")(function* (
  failure: (typeof poisonsFailureFlushCases)[number],
) {
  const directory = yield* tempDirectory();
  const env = new InstrumentedEnv({ cwd: directory });
  const storage = yield* openStorage(directory, env, { fsync: true });
  yield* createRoot(storage);
  const firstId = yield* awaited(storage.mintId<DocumentId>());
  const secondId = yield* awaited(storage.mintId<DocumentId>());
  env.fail(failure);
  yield* awaited(
    expect(
      storage.commit(
        [
          {
            content: { kind: "base", value: {}, version: 1 },
            record: sessionDocument(firstId, "flush.first"),
            type: "document.create",
          },
          {
            content: { kind: "base", value: {}, version: 1 },
            record: sessionDocument(secondId, "flush.second"),
            type: "document.create",
          },
        ],
        context,
      ),
    ).rejects.toThrow("poisoned"),
  );
  const reopened = yield* openStorage(directory);
  expect(yield* awaited(reopened.document(firstId, "current", context))).toBeUndefined();
  expect(yield* awaited(reopened.document(secondId, "current", context))).toBeUndefined();
});

describe("Pico JsonlStorage publication and recovery", () => {
  for (const failure of poisonsFailureFlushCases) {
    it(`poisons after ${failure.mode} failure at flush ${failure.call} and never writes a marker`, () =>
      Effect.runPromise(poisonsFailureFlush(failure)));
  }

  it("orders publication flushes exactly and flushes main only to authorize reclamation", () =>
    Effect.runPromise(ordersPublicationFlushes));
});

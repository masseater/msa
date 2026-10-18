import type { JsonValue } from "@msa/chord";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { DocumentId, EntryId, TaskId } from "../src/types.ts";
import { ROOT_CONVERSATION_ID } from "../src/types.ts";
import { awaited } from "./effect-support.ts";
import {
  terminalTask,
  sessionDocument,
  pendingTask,
  createRoot,
  context,
  openStorage,
  openStorages,
  tempDirectories,
  tempDirectory,
  InstrumentedEnv,
  type Failure,
} from "./jsonl-storage-support.ts";
import { removeDir } from "./platform-support.ts";

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
          type: "document.create",
          record: sessionDocument(secondId, "second"),
          content: { kind: "base", version: 1, value: {} },
        },
        {
          type: "document.create",
          record: sessionDocument(firstId, "first"),
          content: { kind: "base", version: 1, value: {} },
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
  return { env, storage, firstId };
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
          type: "document.change",
          id: firstId,
          content: { kind: "base", version: 1, value: { checkpoint: true } },
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
            id: yield* awaited(storage.mintId<EntryId>()),
            conversationId: ROOT_CONVERSATION_ID,
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

describe("Pico JsonlStorage publication and recovery", () => {
  for (const failure of [
    { operation: "append", call: 1, mode: "before" },
    { operation: "append", call: 1, mode: "after" },
    { operation: "append", call: 1, mode: "short" },
    { operation: "append", call: 2, mode: "before" },
    { operation: "append", call: 2, mode: "after" },
    { operation: "append", call: 3, mode: "before" },
    { operation: "append", call: 3, mode: "short" },
    { operation: "append", call: 3, mode: "after" },
  ] as const satisfies readonly Failure[]) {
    it(`poisons after ${failure.mode} failure at append ${failure.call} and recovers only confirmed state`, () =>
      Effect.runPromise(
        Effect.gen(function* () {
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
                    type: "document.create",
                    record: sessionDocument(firstId, "first"),
                    content: { kind: "base", version: 1, value: { text: "α" } },
                  },
                  {
                    type: "document.create",
                    record: sessionDocument(secondId, "second"),
                    content: { kind: "base", version: 1, value: { text: "β" } },
                  },
                ],
                context,
              ),
            ).rejects.toThrow("poisoned"),
          );
          yield* awaited(
            expect(storage.document(firstId, "current", context)).rejects.toThrow("poisoned"),
          );

          const reopened = yield* openStorage(directory);
          const markerSurvived = failure.call === 3 && failure.mode === "after";
          expect(yield* awaited(reopened.document(firstId, "current", context))).toEqual(
            markerSurvived ? expect.objectContaining({ value: { text: "α" } }) : undefined,
          );
          expect(yield* awaited(reopened.document(secondId, "current", context))).toEqual(
            markerSurvived ? expect.objectContaining({ value: { text: "β" } }) : undefined,
          );
        }),
      ));
  }
});

const ordersPublicationFlushes = Effect.gen(function* () {
  for (const fsync of [false, true]) {
    const store = yield* expectCreateFlushOrder(fsync);
    yield* expectReclaimFlushOrder(store, fsync);
    yield* expectTaskSidecarRemoval(store, fsync);
  }
});

describe("Pico JsonlStorage publication and recovery", () => {
  for (const failure of [
    { operation: "flush", call: 1, mode: "before" },
    { operation: "flush", call: 1, mode: "after" },
    { operation: "flush", call: 2, mode: "before" },
    { operation: "flush", call: 2, mode: "after" },
  ] as const satisfies readonly Failure[]) {
    it(`poisons after ${failure.mode} failure at flush ${failure.call} and never writes a marker`, () =>
      Effect.runPromise(
        Effect.gen(function* () {
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
                    type: "document.create",
                    record: sessionDocument(firstId, "flush.first"),
                    content: { kind: "base", version: 1, value: {} },
                  },
                  {
                    type: "document.create",
                    record: sessionDocument(secondId, "flush.second"),
                    content: { kind: "base", version: 1, value: {} },
                  },
                ],
                context,
              ),
            ).rejects.toThrow("poisoned"),
          );
          const reopened = yield* openStorage(directory);
          expect(yield* awaited(reopened.document(firstId, "current", context))).toBeUndefined();
          expect(yield* awaited(reopened.document(secondId, "current", context))).toBeUndefined();
        }),
      ));
  }

  it("orders publication flushes exactly and flushes main only to authorize reclamation", () =>
    Effect.runPromise(ordersPublicationFlushes));
});

import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import idsModule from "../ids.ts";
import types from "../types.ts";
import type typesModule from "../types.types.ts";
import storageConformanceSupport from "./storage-conformance-support.ts";
import type storageConformanceSupportTypes from "./storage-conformance-support.types.ts";

const { commit, context, createRoot, entry, io, mint, parseJson, pendingTask } =
  storageConformanceSupport;
const { ROOT_CONVERSATION_ID } = types;
const { idFromNumber } = idsModule;

const rootReserved: storageConformanceSupportTypes.StorageCaseSpec = {
  name: "reserves ID 1 for the immutable root conversation",
  test: (storage, expect) =>
    Effect.gen(function* () {
      expect(yield* mint<typesModule.ConversationId>(storage)).toBe(2);
      expect(yield* createRoot(storage)).toBe(ROOT_CONVERSATION_ID);
      expect(yield* io(() => storage.conversation(ROOT_CONVERSATION_ID, context))).toEqual({
        id: ROOT_CONVERSATION_ID,
      });
      yield* expect(
        storage.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], context),
      ).rejects.toThrow(`ID ${ROOT_CONVERSATION_ID} already belongs to conversation`);
    }),
};

const committedMixed = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
) {
  const rootId = yield* createRoot(storage);
  const entryId = yield* mint<typesModule.EntryId>(storage);
  const taskId = yield* mint<typesModule.TaskId<chordTypes.JsonValue>>(storage);
  const submissionId = yield* mint<typesModule.SubmissionId>(storage);
  const task = pendingTask(taskId, rootId);
  const input: typesModule.SubmissionRecord = {
    conversationId: rootId,
    entry: entryId,
    id: submissionId,
    requestId: "request-1",
    status: "placed",
    type: "input",
  };
  const initialSeq = yield* commit(storage, [
    { type: "entry", value: entry(entryId, rootId, "user", { data: { text: "hello" } }) },
    { type: "task", value: task },
    { type: "submission", value: input },
  ]);
  expect(yield* io(() => storage.entry(entryId, context))).toEqual({
    commitSeq: initialSeq,
    entry: entry(entryId, rootId, "user", { data: { text: "hello" } }),
  });
  expect(yield* io(() => storage.task(taskId, context))).toEqual(task);
  expect(yield* io(() => storage.submission(submissionId, context))).toEqual(input);
  return { initialSeq, input, rootId, task };
});

const atomicMixed: storageConformanceSupportTypes.StorageCaseSpec = {
  name: "commits mixed table writes atomically and rolls all of them back on failure",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const { rootId, task, input, initialSeq } = yield* committedMixed(storage, expect);
      const transientEntryId = yield* mint<typesModule.EntryId>(storage);
      const runningTask: storageConformanceSupportTypes.StoredTask = {
        ...task,
        state: { checkpoint: { phase: "effect" }, status: "running" },
      };
      const doneInput: typesModule.SubmissionRecord = {
        ...input,
        answer: transientEntryId,
        status: "done",
      };
      yield* expect(
        storage.commit(
          [
            { type: "task", value: runningTask },
            { type: "submission", value: doneInput },
            { type: "entry", value: entry(transientEntryId, rootId, "assistant") },
            { type: "conversation", value: { id: rootId } },
          ],
          context,
        ),
      ).rejects.toThrow(`ID ${rootId} already belongs to conversation`);

      expect(yield* io(() => storage.task(task.id, context))).toEqual(task);
      expect(yield* io(() => storage.submission(input.id, context))).toEqual(input);
      expect(yield* io(() => storage.entry(transientEntryId, context))).toBeUndefined();
      const afterRollbackSeq = yield* commit(storage, [
        {
          type: "entry",
          value: entry(yield* mint<typesModule.EntryId>(storage), rootId, "after-rollback"),
        },
      ]);
      expect(afterRollbackSeq).toBeGreaterThan(initialSeq);
    }),
};

type DetachedIds = {
  readonly entryId: typesModule.EntryId;
  readonly taskId: typesModule.TaskId<chordTypes.JsonValue>;
  readonly submissionId: typesModule.SubmissionId;
};

const expectDetached = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
  { entryId, taskId, submissionId }: DetachedIds,
) {
  expect((yield* io(() => storage.entry(entryId, context)))?.entry.data).toEqual({
    nested: [1, 2],
  });
  expect((yield* io(() => storage.task(taskId, context)))?.state).toEqual({
    checkpoint: { nested: { count: 1 }, phase: "ready" },
    status: "pending",
  });
  expect((yield* io(() => storage.submission(submissionId, context)))?.detail).toEqual({
    codes: ["initial"],
  });
});

const mutateReads = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  { entryId, taskId, submissionId }: DetachedIds,
) {
  const readEntry = (yield* io(() => storage.entry(entryId, context)))!.entry;
  (readEntry.data as { nested: number[] }).nested.push(9);
  const readTask = (yield* io(() => storage.task(taskId, context)))!;
  if (readTask.state.status !== "terminal") {
    (readTask.state.checkpoint as { phase: string; nested: { count: number } }).nested.count = 9;
  }
  const readInput = (yield* io(() => storage.submission(submissionId, context)))!;
  (readInput.detail as { codes: string[] }).codes.push("read mutation");
});

const detachedRecords: storageConformanceSupportTypes.StorageCaseSpec = {
  name: "detaches retained writes and every returned record",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const rootId = yield* createRoot(storage);
      const entryId = yield* mint<typesModule.EntryId>(storage);
      const taskId = yield* mint<typesModule.TaskId<chordTypes.JsonValue>>(storage);
      const submissionId = yield* mint<typesModule.SubmissionId>(storage);
      const ids: DetachedIds = { entryId, submissionId, taskId };
      const entryData = { nested: [1, 2] };
      const checkpoint = { nested: { count: 1 }, phase: "ready" };
      const detail = { codes: ["initial"] };
      const storedTask: storageConformanceSupportTypes.StoredTask = {
        ...pendingTask(ids.taskId, rootId),
        state: { checkpoint, status: "pending" },
      };
      const storedInput: typesModule.SubmissionRecord = {
        conversationId: rootId,
        detail,
        id: ids.submissionId,
        reason: "failed",
        status: "unanswered",
        type: "input",
      };
      yield* commit(storage, [
        { type: "entry", value: entry(ids.entryId, rootId, "note", { data: entryData }) },
        { type: "task", value: storedTask },
        { type: "submission", value: storedInput },
      ]);
      entryData.nested.push(3);
      checkpoint.nested.count = 2;
      detail.codes.push("mutated");
      yield* expectDetached(storage, expect, ids);
      yield* mutateReads(storage, ids);
      yield* expectDetached(storage, expect, ids);
    }),
};

const prototypeKeys: storageConformanceSupportTypes.StorageCaseSpec = {
  name: "detaches prototype-like JSON keys without changing object prototypes",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const rootId = yield* createRoot(storage);
      const entryId = yield* mint<typesModule.EntryId>(storage);
      const data = (yield* parseJson(
        '{"__proto__":{"polluted":false},"constructor":{"label":"stored"},"toString":"value"}',
      )) as Record<string, chordTypes.JsonValue>;
      yield* commit(storage, [{ type: "entry", value: entry(entryId, rootId, "note", { data }) }]);

      (Reflect.get(data, "__proto__") as Record<string, chordTypes.JsonValue>)["polluted"] = true;
      (Reflect.get(data, "constructor") as Record<string, chordTypes.JsonValue>)["label"] =
        "mutated";
      const firstRead = (yield* io(() => storage.entry(entryId, context)))!.entry.data as Record<
        string,
        chordTypes.JsonValue
      >;
      expect(Object.getPrototypeOf(firstRead)).toBe(Object.prototype);
      expect(Object.hasOwn(firstRead, "__proto__")).toBe(true);
      expect(Reflect.get(firstRead, "__proto__")).toEqual({ polluted: false });
      expect(Reflect.get(firstRead, "constructor")).toEqual({ label: "stored" });
      expect(Reflect.get(firstRead, "toString")).toBe("value");
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();

      (Reflect.get(firstRead, "__proto__") as Record<string, chordTypes.JsonValue>)["polluted"] =
        true;
      const secondRead = (yield* io(() => storage.entry(entryId, context)))!.entry.data as Record<
        string,
        chordTypes.JsonValue
      >;
      expect(Reflect.get(secondRead, "__proto__")).toEqual({ polluted: false });
      expect(Reflect.get(secondRead, "constructor")).toEqual({ label: "stored" });
      expect(Reflect.get(secondRead, "toString")).toBe("value");
    }),
};

const globalIds: storageConformanceSupportTypes.StorageCaseSpec = {
  name: "keeps one global record ID namespace and rejects exhausted ID minting",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const rootId = yield* createRoot(storage);
      const explicitEntryId = idFromNumber<typesModule.EntryId>(100);
      yield* commit(storage, [{ type: "entry", value: entry(explicitEntryId, rootId) }]);
      expect(yield* mint<typesModule.EntryId>(storage)).toBe(101);
      yield* expect(
        storage.commit(
          [
            {
              type: "task",
              value: pendingTask(
                idFromNumber<typesModule.TaskId<chordTypes.JsonValue>>(explicitEntryId),
                rootId,
              ),
            },
          ],
          context,
        ),
      ).rejects.toThrow(`ID ${explicitEntryId} already belongs to entry`);

      yield* commit(storage, [
        {
          type: "entry",
          value: entry(
            idFromNumber<typesModule.EntryId>(Number.MAX_SAFE_INTEGER),
            rootId,
            "last-id",
          ),
        },
      ]);
      yield* expect(storage.mintId<typesModule.EntryId>()).rejects.toThrow("ID space is exhausted");
      yield* expect(storage.mintId<typesModule.EntryId>()).rejects.toThrow("ID space is exhausted");
    }),
};

const closed: storageConformanceSupportTypes.StorageCaseSpec = {
  name: "rejects every operation after close",
  test: (storage, expect) =>
    Effect.gen(function* () {
      yield* createRoot(storage);
      yield* io(() => storage.close(context));
      yield* expect(storage.conversation(ROOT_CONVERSATION_ID, context)).rejects.toThrow("closed");
      yield* expect(
        storage.commit([] satisfies typesModule.StorageWrite[], context),
      ).rejects.toThrow("closed");
      yield* expect(storage.mintId<typesModule.ConversationId>()).rejects.toThrow("closed");
    }),
};

const recordsCases: readonly storageConformanceSupportTypes.StorageCaseSpec[] = [
  rootReserved,
  atomicMixed,
  detachedRecords,
  prototypeKeys,
];

const namespaceCases: readonly storageConformanceSupportTypes.StorageCaseSpec[] = [
  globalIds,
  closed,
];

const storageConformanceRecords = {
  namespaceCases,
  recordsCases,
};

export default storageConformanceRecords;

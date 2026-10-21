import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import type typesModule from "../types.types.ts";
import storageConformanceSupport from "./storage-conformance-support.ts";
import type storageConformanceSupportTypes from "./storage-conformance-support.types.ts";

const { commit, context, createRoot, io, mint, pendingTask } = storageConformanceSupport;

const seedTasks = Effect.fnUntraced(function* (storage: typesModule.Storage) {
  const rootId = yield* createRoot(storage);
  const firstId = yield* mint<typesModule.TaskId<chordTypes.JsonValue>>(storage);
  const secondId = yield* mint<typesModule.TaskId<chordTypes.JsonValue>>(storage);
  const thirdId = yield* mint<typesModule.TaskId<chordTypes.JsonValue>>(storage);
  const first = {
    ...pendingTask(firstId, rootId),
    memos: { winner: "first" },
  } satisfies storageConformanceSupportTypes.StoredTask;
  yield* commit(storage, [
    { type: "task", value: first },
    { type: "task", value: { ...pendingTask(secondId, rootId), background: true } },
    { type: "task", value: { ...pendingTask(thirdId, rootId), abortRequested: true } },
  ]);
  return { first, rootId, secondId, thirdId };
});

const replaceTask = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
  rootId: typesModule.ConversationId,
  first: storageConformanceSupportTypes.StoredTask,
) {
  const running: storageConformanceSupportTypes.StoredTask = {
    ...first,
    abortRequested: true,
    state: { checkpoint: { attempt: 1, phase: "effect" }, status: "running" },
  };
  yield* commit(storage, [{ type: "task", value: running }]);
  expect(yield* io(() => storage.task(first.id, context))).toEqual(running);
  const terminal: storageConformanceSupportTypes.StoredTask = {
    abortRequested: true,
    background: false,
    conversationId: rootId,
    id: first.id,
    input: first.input,
    kind: first.kind,
    state: { outcome: { result: { entryId: 99 }, status: "completed" }, status: "terminal" },
    version: first.version,
  };
  yield* commit(storage, [{ type: "task", value: terminal }]);
  expect(yield* io(() => storage.task(first.id, context))).toEqual(terminal);
  return terminal;
});

const taskRecords: storageConformanceSupportTypes.StorageCaseSpec = {
  name: "replaces complete task records and pages filtered task scans",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const { rootId, first, secondId, thirdId } = yield* seedTasks(storage);
      const terminal = yield* replaceTask(storage, expect, rootId, first);
      const scan = (
        query: Parameters<typesModule.Storage["scanTasks"]>[0],
        limit: number,
        cursor?: typesModule.Cursor,
      ) => io(() => storage.scanTasks(query, limit, cursor, context));
      const pendingPage = yield* scan({ status: "pending" }, 1);
      expect(pendingPage.items.map(({ id }) => id)).toEqual([secondId]);
      expect(pendingPage.next).toBeDefined();
      expect(
        (yield* scan({ status: "pending" }, 1, pendingPage.next)).items.map(({ id }) => id),
      ).toEqual([thirdId]);
      expect((yield* scan({ abortRequested: true, status: "terminal" }, 10)).items).toEqual([
        terminal,
      ]);
      expect((yield* scan({ background: true }, 10)).items.map(({ id }) => id)).toEqual([secondId]);
    }),
};

const seedWaitingTasks = Effect.fnUntraced(function* (storage: typesModule.Storage) {
  const rootId = yield* createRoot(storage);
  const ownerId = yield* mint<typesModule.TaskId<chordTypes.JsonValue>>(storage);
  const waitingId = yield* mint<typesModule.TaskId<chordTypes.JsonValue>>(storage);
  const completingId = yield* mint<typesModule.TaskId<chordTypes.JsonValue>>(storage);
  const owner = pendingTask(ownerId, rootId);
  const waiting: storageConformanceSupportTypes.StoredTask = {
    ...pendingTask(waitingId, rootId),
    memos: { kept: true },
    owner: ownerId,
    state: {
      checkpoint: { phase: "next" },
      on: [ownerId],
      policy: "allSettled",
      status: "waiting",
    },
  };
  const completing: storageConformanceSupportTypes.StoredTask = {
    ...pendingTask(completingId, rootId),
    owner: ownerId,
    state: { outcome: { error: { message: "held" }, status: "failed" }, status: "completing" },
  };
  const writes = [owner, waiting, completing].map((value) => ({ type: "task", value }) as const);
  yield* commit(storage, writes);
  return { completing, ownerId, waiting };
});

const waitingTasks: storageConformanceSupportTypes.StorageCaseSpec = {
  name: "stores owners and scans waiting and completing tasks by status",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const { ownerId, waiting, completing } = yield* seedWaitingTasks(storage);
      expect(yield* io(() => storage.task(waiting.id, context))).toEqual(waiting);
      expect(yield* io(() => storage.task(completing.id, context))).toEqual(completing);
      const scan = (status: storageConformanceSupportTypes.StoredTask["state"]["status"]) =>
        Effect.map(
          io(() => storage.scanTasks({ status }, 10, undefined, context)),
          (page) => page.items,
        );
      expect(yield* scan("waiting")).toEqual([waiting]);
      expect(yield* scan("completing")).toEqual([completing]);
      expect((yield* scan("pending")).map(({ id }) => id)).toEqual([ownerId]);
      const terminal: storageConformanceSupportTypes.StoredTask = {
        ...completing,
        state: { outcome: completing.state.outcome!, status: "terminal" },
      };
      yield* commit(storage, [{ type: "task", value: terminal }]);
      expect(yield* scan("completing")).toEqual([]);
      expect(yield* scan("terminal")).toEqual([terminal]);
    }),
};

const queuedSubmission = (
  id: typesModule.SubmissionId,
  conversationId: typesModule.ConversationId,
  requestId: string,
) =>
  ({
    conversationId,
    id,
    requestId,
    status: "queued" as const,
    type: "input" as const,
  }) satisfies typesModule.SubmissionRecord;

const seedSubmissions = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
) {
  const rootId = yield* createRoot(storage);
  const secondConversationId = yield* mint<typesModule.ConversationId>(storage);
  yield* commit(storage, [{ type: "conversation", value: { id: secondConversationId } }]);
  const first = queuedSubmission(yield* mint<typesModule.SubmissionId>(storage), rootId, "same");
  const second = queuedSubmission(yield* mint<typesModule.SubmissionId>(storage), rootId, "other");
  const otherConversation = queuedSubmission(
    yield* mint<typesModule.SubmissionId>(storage),
    secondConversationId,
    "same",
  );
  yield* commit(storage, [
    { type: "submission", value: first },
    { type: "submission", value: second },
    { type: "submission", value: otherConversation },
  ]);
  expect(yield* io(() => storage.submissionByRequest(rootId, "same", context))).toEqual(first);
  expect(
    yield* io(() => storage.submissionByRequest(secondConversationId, "same", context)),
  ).toEqual(otherConversation);
  const placedSecond: typesModule.SubmissionRecord = {
    ...second,
    entry: yield* mint<typesModule.EntryId>(storage),
    status: "placed",
  };
  yield* commit(storage, [{ type: "submission", value: placedSecond }]);
  expect(yield* io(() => storage.submission(second.id, context))).toEqual(placedSecond);
  expect(yield* io(() => storage.submissionByRequest(rootId, "other", context))).toEqual(
    placedSecond,
  );
  return { first, otherConversation, placedSecond, rootId, secondConversationId };
});

const submissionIds = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  query: typesModule.SubmissionQuery,
) {
  const found: typesModule.SubmissionId[] = [];
  let cursor: typesModule.Cursor | undefined;
  do {
    const current = cursor;
    const page = yield* io(() => storage.scanSubmissions(query, 1, current, context));
    found.push(...page.items.map(({ id }) => id));
    cursor = page.next;
  } while (cursor !== undefined);
  return found;
});

const requestIds: storageConformanceSupportTypes.StorageCaseSpec = {
  name: "indexes request IDs per conversation and replaces complete submission records",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const seeded = yield* seedSubmissions(storage, expect);
      const { rootId, secondConversationId, placedSecond } = seeded;
      const firstId = seeded.first.id;
      const secondId = placedSecond.id;
      const otherId = seeded.otherConversation.id;
      const ids = (query: typesModule.SubmissionQuery) => submissionIds(storage, query);
      expect(yield* ids({})).toEqual([firstId, secondId, otherId]);
      expect(yield* ids({ conversationId: rootId })).toEqual([firstId, secondId]);
      expect(yield* ids({ status: "queued" })).toEqual([firstId, otherId]);
      expect(yield* ids({ status: "placed" })).toEqual([secondId]);
      expect(yield* ids({ conversationId: secondConversationId, status: "queued" })).toEqual([
        otherId,
      ]);
      expect(yield* ids({ conversationId: secondConversationId, status: "placed" })).toEqual([]);
      expect(
        (yield* io(() => storage.scanSubmissions({ status: "placed" }, 10, undefined, context)))
          .items,
      ).toEqual([placedSecond]);
    }),
};

const passiveWrites: storageConformanceSupportTypes.StorageCaseSpec = {
  name: "stores passive write submissions without input-only lifecycle states",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const rootId = yield* createRoot(storage);
      const queued = (id: typesModule.SubmissionId, requestId: string) =>
        ({
          conversationId: rootId,
          id,
          requestId,
          status: "queued" as const,
          type: "write" as const,
        }) satisfies typesModule.SubmissionRecord;
      const queuedDone = queued(yield* mint<typesModule.SubmissionId>(storage), "passive-done");
      const queuedFailed = queued(yield* mint<typesModule.SubmissionId>(storage), "passive-failed");
      yield* commit(storage, [
        { type: "submission", value: queuedDone },
        { type: "submission", value: queuedFailed },
      ]);
      const done: typesModule.SubmissionRecord = {
        ...queuedDone,
        entry: yield* mint<typesModule.EntryId>(storage),
        status: "done",
      };
      const unanswered: typesModule.SubmissionRecord = {
        ...queuedFailed,
        detail: { retryable: false },
        reason: "closed",
        status: "unanswered",
      };
      yield* commit(storage, [
        { type: "submission", value: done },
        { type: "submission", value: unanswered },
      ]);
      const byRequest = (requestId: string) =>
        io(() => storage.submissionByRequest(rootId, requestId, context));
      expect(yield* io(() => storage.submission(done.id, context))).toEqual(done);
      expect(yield* byRequest("passive-done")).toEqual(done);
      expect(yield* io(() => storage.submission(unanswered.id, context))).toEqual(unanswered);
      expect(yield* byRequest("passive-failed")).toEqual(unanswered);
    }),
};

const tasksCases: readonly storageConformanceSupportTypes.StorageCaseSpec[] = [
  taskRecords,
  waitingTasks,
  requestIds,
  passiveWrites,
];

const storageConformanceTasks = {
  tasksCases,
};

export default storageConformanceTasks;

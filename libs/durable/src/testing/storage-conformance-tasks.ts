import type { JsonValue } from "@msa/chord";
import { Effect } from "effect";

import type {
  ConversationId,
  Cursor,
  EntryId,
  Storage,
  SubmissionId,
  SubmissionQuery,
  SubmissionRecord,
  TaskId,
} from "../types.ts";
import {
  commit,
  context,
  createRoot,
  type Expect,
  io,
  mint,
  pendingTask,
  type StorageCaseSpec,
  type StoredTask,
} from "./storage-conformance-support.ts";

const seedTasks = Effect.fnUntraced(function* (storage: Storage) {
  const rootId = yield* createRoot(storage);
  const firstId = yield* mint<TaskId<JsonValue>>(storage);
  const secondId = yield* mint<TaskId<JsonValue>>(storage);
  const thirdId = yield* mint<TaskId<JsonValue>>(storage);
  const first = {
    ...pendingTask(firstId, rootId),
    memos: { winner: "first" },
  } satisfies StoredTask;
  yield* commit(storage, [
    { type: "task", value: first },
    { type: "task", value: { ...pendingTask(secondId, rootId), background: true } },
    { type: "task", value: { ...pendingTask(thirdId, rootId), abortRequested: true } },
  ]);
  return { rootId, first, secondId, thirdId };
});

const replaceTask = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  rootId: ConversationId,
  first: StoredTask,
) {
  const running: StoredTask = {
    ...first,
    state: { status: "running", checkpoint: { phase: "effect", attempt: 1 } },
    abortRequested: true,
  };
  yield* commit(storage, [{ type: "task", value: running }]);
  expect(yield* io(() => storage.task(first.id, context))).toEqual(running);
  const terminal: StoredTask = {
    id: first.id,
    conversationId: rootId,
    kind: first.kind,
    version: first.version,
    input: first.input,
    state: { status: "terminal", outcome: { status: "completed", result: { entryId: 99 } } },
    background: false,
    abortRequested: true,
  };
  yield* commit(storage, [{ type: "task", value: terminal }]);
  expect(yield* io(() => storage.task(first.id, context))).toEqual(terminal);
  return terminal;
});

const taskRecords: StorageCaseSpec = {
  name: "replaces complete task records and pages filtered task scans",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const { rootId, first, secondId, thirdId } = yield* seedTasks(storage);
      const terminal = yield* replaceTask(storage, expect, rootId, first);
      const scan = (query: Parameters<Storage["scanTasks"]>[0], limit: number, cursor?: Cursor) =>
        io(() => storage.scanTasks(query, limit, cursor, context));
      const pendingPage = yield* scan({ status: "pending" }, 1);
      expect(pendingPage.items.map(({ id }) => id)).toEqual([secondId]);
      expect(pendingPage.next).toBeDefined();
      expect(
        (yield* scan({ status: "pending" }, 1, pendingPage.next)).items.map(({ id }) => id),
      ).toEqual([thirdId]);
      expect((yield* scan({ status: "terminal", abortRequested: true }, 10)).items).toEqual([
        terminal,
      ]);
      expect((yield* scan({ background: true }, 10)).items.map(({ id }) => id)).toEqual([secondId]);
    }),
};

const seedWaitingTasks = Effect.fnUntraced(function* (storage: Storage) {
  const rootId = yield* createRoot(storage);
  const ownerId = yield* mint<TaskId<JsonValue>>(storage);
  const waitingId = yield* mint<TaskId<JsonValue>>(storage);
  const completingId = yield* mint<TaskId<JsonValue>>(storage);
  const owner = pendingTask(ownerId, rootId);
  const waiting: StoredTask = {
    ...pendingTask(waitingId, rootId),
    owner: ownerId,
    state: {
      status: "waiting",
      checkpoint: { phase: "next" },
      on: [ownerId],
      policy: "allSettled",
    },
    memos: { kept: true },
  };
  const completing: StoredTask = {
    ...pendingTask(completingId, rootId),
    owner: ownerId,
    state: { status: "completing", outcome: { status: "failed", error: { message: "held" } } },
  };
  const writes = [owner, waiting, completing].map((value) => ({ type: "task", value }) as const);
  yield* commit(storage, writes);
  return { ownerId, waiting, completing };
});

const waitingTasks: StorageCaseSpec = {
  name: "stores owners and scans waiting and completing tasks by status",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const { ownerId, waiting, completing } = yield* seedWaitingTasks(storage);
      expect(yield* io(() => storage.task(waiting.id, context))).toEqual(waiting);
      expect(yield* io(() => storage.task(completing.id, context))).toEqual(completing);
      const scan = (status: StoredTask["state"]["status"]) =>
        Effect.map(
          io(() => storage.scanTasks({ status }, 10, undefined, context)),
          (page) => page.items,
        );
      expect(yield* scan("waiting")).toEqual([waiting]);
      expect(yield* scan("completing")).toEqual([completing]);
      expect((yield* scan("pending")).map(({ id }) => id)).toEqual([ownerId]);
      const terminal: StoredTask = {
        ...completing,
        state: { status: "terminal", outcome: completing.state.outcome! },
      };
      yield* commit(storage, [{ type: "task", value: terminal }]);
      expect(yield* scan("completing")).toEqual([]);
      expect(yield* scan("terminal")).toEqual([terminal]);
    }),
};

const queuedSubmission = (id: SubmissionId, conversationId: ConversationId, requestId: string) =>
  ({
    id,
    conversationId,
    requestId,
    type: "input" as const,
    status: "queued" as const,
  }) satisfies SubmissionRecord;

const seedSubmissions = Effect.fnUntraced(function* (storage: Storage, expect: Expect) {
  const rootId = yield* createRoot(storage);
  const secondConversationId = yield* mint<ConversationId>(storage);
  yield* commit(storage, [{ type: "conversation", value: { id: secondConversationId } }]);
  const first = queuedSubmission(yield* mint<SubmissionId>(storage), rootId, "same");
  const second = queuedSubmission(yield* mint<SubmissionId>(storage), rootId, "other");
  const otherConversation = queuedSubmission(
    yield* mint<SubmissionId>(storage),
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
  const placedSecond: SubmissionRecord = {
    ...second,
    status: "placed",
    entry: yield* mint<EntryId>(storage),
  };
  yield* commit(storage, [{ type: "submission", value: placedSecond }]);
  expect(yield* io(() => storage.submission(second.id, context))).toEqual(placedSecond);
  expect(yield* io(() => storage.submissionByRequest(rootId, "other", context))).toEqual(
    placedSecond,
  );
  return { rootId, secondConversationId, first, placedSecond, otherConversation };
});

const submissionIds = Effect.fnUntraced(function* (storage: Storage, query: SubmissionQuery) {
  const found: SubmissionId[] = [];
  let cursor: Cursor | undefined;
  do {
    const current = cursor;
    const page = yield* io(() => storage.scanSubmissions(query, 1, current, context));
    found.push(...page.items.map(({ id }) => id));
    cursor = page.next;
  } while (cursor !== undefined);
  return found;
});

const requestIds: StorageCaseSpec = {
  name: "indexes request IDs per conversation and replaces complete submission records",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const seeded = yield* seedSubmissions(storage, expect);
      const { rootId, secondConversationId, placedSecond } = seeded;
      const firstId = seeded.first.id;
      const secondId = placedSecond.id;
      const otherId = seeded.otherConversation.id;
      const ids = (query: SubmissionQuery) => submissionIds(storage, query);
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

const passiveWrites: StorageCaseSpec = {
  name: "stores passive write submissions without input-only lifecycle states",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const rootId = yield* createRoot(storage);
      const queued = (id: SubmissionId, requestId: string) =>
        ({
          id,
          conversationId: rootId,
          requestId,
          type: "write" as const,
          status: "queued" as const,
        }) satisfies SubmissionRecord;
      const queuedDone = queued(yield* mint<SubmissionId>(storage), "passive-done");
      const queuedFailed = queued(yield* mint<SubmissionId>(storage), "passive-failed");
      yield* commit(storage, [
        { type: "submission", value: queuedDone },
        { type: "submission", value: queuedFailed },
      ]);
      const done: SubmissionRecord = {
        ...queuedDone,
        status: "done",
        entry: yield* mint<EntryId>(storage),
      };
      const unanswered: SubmissionRecord = {
        ...queuedFailed,
        status: "unanswered",
        reason: "closed",
        detail: { retryable: false },
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

export const tasksCases: readonly StorageCaseSpec[] = [
  taskRecords,
  waitingTasks,
  requestIds,
  passiveWrites,
];

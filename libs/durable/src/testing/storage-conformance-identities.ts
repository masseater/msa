import type { JsonValue } from "@msa/chord";
import { Effect } from "effect";

import type {
  DocumentCreate,
  DocumentId,
  Storage,
  StorageWrite,
  SubmissionId,
  TaskId,
} from "../types.ts";
import {
  commit,
  context,
  createRoot,
  documentIds,
  type Expect,
  io,
  mint,
  pendingTask,
  type StorageCaseSpec,
} from "./storage-conformance-support.ts";

const first = "\ud800";
const second = "\ud801";

const created = (record: DocumentCreate, identity: string): StorageWrite => ({
  type: "document.create",
  record,
  content: { kind: "base", version: 1, value: { identity } },
});

const seedIdentities = Effect.fnUntraced(function* (storage: Storage) {
  const rootId = yield* createRoot(storage);
  const firstTaskId = yield* mint<TaskId<JsonValue>>(storage);
  const secondTaskId = yield* mint<TaskId<JsonValue>>(storage);
  const firstSubmissionId = yield* mint<SubmissionId>(storage);
  const secondSubmissionId = yield* mint<SubmissionId>(storage);
  const firstKindDocumentId = yield* mint<DocumentId>(storage);
  const secondKindDocumentId = yield* mint<DocumentId>(storage);
  const firstKeyDocumentId = yield* mint<DocumentId>(storage);
  const secondKeyDocumentId = yield* mint<DocumentId>(storage);
  const session = { kind: "session" } as const;
  const submission = (id: SubmissionId, requestId: string): StorageWrite => ({
    type: "submission",
    value: { id, conversationId: rootId, requestId, type: "input", status: "queued" },
  });
  yield* commit(storage, [
    { type: "task", value: { ...pendingTask(firstTaskId, rootId), kind: first } },
    { type: "task", value: { ...pendingTask(secondTaskId, rootId), kind: second } },
    submission(firstSubmissionId, first),
    submission(secondSubmissionId, second),
    created({ id: firstKindDocumentId, kind: first, scope: session }, "first kind"),
    created({ id: secondKindDocumentId, kind: second, scope: session }, "second kind"),
    created({ id: firstKeyDocumentId, kind: "family", key: first, scope: session }, "first key"),
    created({ id: secondKeyDocumentId, kind: "family", key: second, scope: session }, "second key"),
  ]);
  return {
    rootId,
    firstTaskId,
    secondTaskId,
    firstSubmissionId,
    secondSubmissionId,
    firstKindDocumentId,
    secondKindDocumentId,
    firstKeyDocumentId,
    secondKeyDocumentId,
  };
});

type Identities = Effect.Success<ReturnType<typeof seedIdentities>>;

const expectRecordIdentities = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  ids: Identities,
) {
  const taskIds = (kind: string) =>
    Effect.map(
      io(() => storage.scanTasks({ kind }, 10, undefined, context)),
      (page) => page.items.map(({ id }) => id),
    );
  const byRequest = (requestId: string) =>
    io(() => storage.submissionByRequest(ids.rootId, requestId, context));
  expect(yield* taskIds(first)).toEqual([ids.firstTaskId]);
  expect(yield* taskIds(second)).toEqual([ids.secondTaskId]);
  expect((yield* io(() => storage.task(ids.firstTaskId, context)))?.kind).toBe(first);
  expect((yield* io(() => storage.task(ids.secondTaskId, context)))?.kind).toBe(second);
  expect((yield* byRequest(first))?.requestId).toBe(first);
  expect((yield* byRequest(first))?.id).toBe(ids.firstSubmissionId);
  expect((yield* byRequest(second))?.id).toBe(ids.secondSubmissionId);
});

const expectDocumentIdentities = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  ids: Identities,
) {
  const session = { kind: "session" } as const;
  const foundId = (address: Parameters<Storage["findDocument"]>[0]) =>
    Effect.map(
      io(() => storage.findDocument(address, "current", context)),
      (found) => found?.id,
    );
  expect(yield* foundId({ kind: first, scope: session })).toBe(ids.firstKindDocumentId);
  expect(yield* foundId({ kind: second, scope: session })).toBe(ids.secondKindDocumentId);
  expect(yield* foundId({ kind: "family", key: first, scope: session })).toBe(
    ids.firstKeyDocumentId,
  );
  expect(yield* foundId({ kind: "family", key: second, scope: session })).toBe(
    ids.secondKeyDocumentId,
  );
  expect(yield* documentIds(storage, { scope: session, at: "current", kind: first })).toEqual([
    ids.firstKindDocumentId,
  ]);
});

const losslessIdentities: StorageCaseSpec = {
  name: "keeps indexed string identities lossless",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const ids = yield* seedIdentities(storage);
      yield* expectRecordIdentities(storage, expect, ids);
      yield* expectDocumentIdentities(storage, expect, ids);
    }),
};

export const identityCases: readonly StorageCaseSpec[] = [losslessIdentities];

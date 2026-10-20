import type { JsonValue } from "@msa/chord";
import { Effect } from "effect";

import type typesModule from "../types.types.ts";
import storageConformanceSupport from "./storage-conformance-support.ts";
import type storageConformanceSupportTypes from "./storage-conformance-support.types.ts";

const { commit, context, createRoot, documentIds, io, mint, pendingTask } =
  storageConformanceSupport;

const first = "\ud800";
const second = "\ud801";

const created = (
  record: typesModule.DocumentCreate,
  identity: string,
): typesModule.StorageWrite => ({
  content: { kind: "base", value: { identity }, version: 1 },
  record,
  type: "document.create",
});

const seedIdentities = Effect.fnUntraced(function* (storage: typesModule.Storage) {
  const rootId = yield* createRoot(storage);
  const firstTaskId = yield* mint<typesModule.TaskId<JsonValue>>(storage);
  const secondTaskId = yield* mint<typesModule.TaskId<JsonValue>>(storage);
  const firstSubmissionId = yield* mint<typesModule.SubmissionId>(storage);
  const secondSubmissionId = yield* mint<typesModule.SubmissionId>(storage);
  const firstKindDocumentId = yield* mint<typesModule.DocumentId>(storage);
  const secondKindDocumentId = yield* mint<typesModule.DocumentId>(storage);
  const firstKeyDocumentId = yield* mint<typesModule.DocumentId>(storage);
  const secondKeyDocumentId = yield* mint<typesModule.DocumentId>(storage);
  const session = { kind: "session" } as const;
  const submission = (
    id: typesModule.SubmissionId,
    requestId: string,
  ): typesModule.StorageWrite => ({
    type: "submission",
    value: { conversationId: rootId, id, requestId, status: "queued", type: "input" },
  });
  yield* commit(storage, [
    { type: "task", value: { ...pendingTask(firstTaskId, rootId), kind: first } },
    { type: "task", value: { ...pendingTask(secondTaskId, rootId), kind: second } },
    submission(firstSubmissionId, first),
    submission(secondSubmissionId, second),
    created({ id: firstKindDocumentId, kind: first, scope: session }, "first kind"),
    created({ id: secondKindDocumentId, kind: second, scope: session }, "second kind"),
    created({ id: firstKeyDocumentId, key: first, kind: "family", scope: session }, "first key"),
    created({ id: secondKeyDocumentId, key: second, kind: "family", scope: session }, "second key"),
  ]);
  return {
    firstKeyDocumentId,
    firstKindDocumentId,
    firstSubmissionId,
    firstTaskId,
    rootId,
    secondKeyDocumentId,
    secondKindDocumentId,
    secondSubmissionId,
    secondTaskId,
  };
});

type Identities = Effect.Success<ReturnType<typeof seedIdentities>>;

const expectRecordIdentities = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
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
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
  ids: Identities,
) {
  const session = { kind: "session" } as const;
  const foundId = (address: Parameters<typesModule.Storage["findDocument"]>[0]) =>
    Effect.map(
      io(() => storage.findDocument(address, "current", context)),
      (found) => found?.id,
    );
  expect(yield* foundId({ kind: first, scope: session })).toBe(ids.firstKindDocumentId);
  expect(yield* foundId({ kind: second, scope: session })).toBe(ids.secondKindDocumentId);
  expect(yield* foundId({ key: first, kind: "family", scope: session })).toBe(
    ids.firstKeyDocumentId,
  );
  expect(yield* foundId({ key: second, kind: "family", scope: session })).toBe(
    ids.secondKeyDocumentId,
  );
  expect(yield* documentIds(storage, { at: "current", kind: first, scope: session })).toEqual([
    ids.firstKindDocumentId,
  ]);
});

const losslessIdentities: storageConformanceSupportTypes.StorageCaseSpec = {
  name: "keeps indexed string identities lossless",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const ids = yield* seedIdentities(storage);
      yield* expectRecordIdentities(storage, expect, ids);
      yield* expectDocumentIdentities(storage, expect, ids);
    }),
};

const identityCases: readonly storageConformanceSupportTypes.StorageCaseSpec[] = [
  losslessIdentities,
];

const storageConformanceIdentities = {
  identityCases,
};

export default storageConformanceIdentities;

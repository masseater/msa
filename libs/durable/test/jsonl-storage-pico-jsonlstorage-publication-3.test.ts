import type { JsonValue } from "@msa/chord";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { DocumentId, TaskId } from "../src/types.ts";
import { ROOT_CONVERSATION_ID } from "../src/types.ts";
import effectSupport from "./effect-support.ts";
import jsonlStorageSupport from "./jsonl-storage-support.ts";
import platformSupport from "./platform-support.ts";

const { awaited } = effectSupport;
const {
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
const { appendBytes, fileSize, joinPath, removeDir } = platformSupport;

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

const rewindableHistory = Effect.fn("rewindableHistory")(function* () {
  const directory = yield* tempDirectory();
  const storage = yield* openStorage(directory);
  yield* createRoot(storage);
  const id = yield* awaited(storage.mintId<DocumentId>());
  const record = {
    fork: "asOf" as const,
    history: "rewindable" as const,
    id,
    kind: "rewindable",
    scope: { conversationId: ROOT_CONVERSATION_ID, kind: "conversation" as const },
  };
  const createdAt = yield* awaited(
    storage.commit(
      [
        {
          content: { kind: "base", value: { count: 0 }, version: 1 },
          record,
          type: "document.create",
        },
      ],
      context,
    ),
  );
  const changedAt = yield* awaited(
    storage.commit(
      [
        {
          content: { kind: "delta", ops: [["s", ["count"], 1]], version: 1 },
          id,
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
          content: { kind: "base", value: { count: 2 }, version: 1 },
          id,
          type: "document.change",
        },
      ],
      context,
    ),
  );
  return { changedAt, createdAt, directory, id, storage };
});

const retiredSidecars = Effect.fn("retiredSidecars")(function* () {
  const directory = yield* tempDirectory();
  const storage = yield* openStorage(directory);
  yield* createRoot(storage);
  const taskId = yield* awaited(storage.mintId<TaskId<JsonValue>>());
  const sessionId = yield* awaited(storage.mintId<DocumentId>());
  const latestId = yield* awaited(storage.mintId<DocumentId>());
  const taskDocumentId = yield* awaited(storage.mintId<DocumentId>());
  const createdAt = yield* awaited(
    storage.commit(
      [
        { type: "task", value: pendingTask(taskId) },
        {
          content: { kind: "base", value: {}, version: 1 },
          record: sessionDocument(sessionId, "session"),
          type: "document.create",
        },
        {
          content: { kind: "base", value: {}, version: 1 },
          record: {
            fork: "current",
            history: "latest",
            id: latestId,
            kind: "latest",
            scope: { conversationId: ROOT_CONVERSATION_ID, kind: "conversation" },
          },
          type: "document.create",
        },
        {
          content: { kind: "base", value: {}, version: 1 },
          record: { id: taskDocumentId, kind: "task", scope: { kind: "task", taskId } },
          type: "document.create",
        },
      ],
      context,
    ),
  );
  const retiredAt = yield* awaited(
    storage.commit(
      [
        { id: sessionId, type: "document.retire" },
        { id: latestId, type: "document.retire" },
        { id: taskDocumentId, type: "document.retire" },
        { type: "task", value: terminalTask(taskId) },
      ],
      context,
    ),
  );
  return { createdAt, directory, latestId, retiredAt, sessionId, taskDocumentId, taskId };
});

const neverReclaimsRewindable = Effect.gen(function* () {
  const { directory, storage, id, createdAt, changedAt } = yield* rewindableHistory();
  yield* awaited(storage.commit([{ id, type: "document.retire" }], context));

  expect(yield* readLines(joinPath(directory, `doc-${id}.jsonl`))).toHaveLength(3);
  const reopened = yield* openStorage(directory);
  expect((yield* awaited(reopened.document(id, createdAt, context)))?.value).toEqual({
    count: 0,
  });
  expect((yield* awaited(reopened.document(id, changedAt, context)))?.value).toEqual({
    count: 1,
  });
  expect(yield* awaited(reopened.document(id, "current", context))).toBeUndefined();
  expect(yield* readLines(joinPath(directory, `doc-${id}.jsonl`))).toHaveLength(3);
});

const reclaimsRetiredTask = Effect.gen(function* () {
  const { directory, taskId, sessionId, latestId, taskDocumentId, createdAt, retiredAt } =
    yield* retiredSidecars();
  for (const file of [
    `doc-${sessionId}.jsonl`,
    `doc-${latestId}.jsonl`,
    `doc-${taskDocumentId}.jsonl`,
    `task-${taskId}.jsonl`,
  ]) {
    expect(yield* fileExists(joinPath(directory, file))).toBe(false);
  }

  const reopened = yield* openStorage(directory);
  expect(yield* awaited(reopened.task(taskId, context))).toEqual(terminalTask(taskId));
  expect(yield* awaited(reopened.document(sessionId, "current", context))).toBeUndefined();
  expect(yield* awaited(reopened.document(latestId, "current", context))).toBeUndefined();
  expect(yield* awaited(reopened.document(taskDocumentId, "current", context))).toBeUndefined();
  expect(
    yield* awaited(
      reopened.findDocument({ kind: "session", scope: { kind: "session" } }, createdAt, context),
    ),
  ).toMatchObject({ createdAt, id: sessionId, retiredAt });
  expect(
    yield* awaited(
      reopened.findDocument({ kind: "session", scope: { kind: "session" } }, retiredAt, context),
    ),
  ).toBeUndefined();
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("never reclaims rewindable document history, including after a base and retirement", () =>
    Effect.runPromise(neverReclaimsRewindable));

  it("reclaims retired task-, session-, and latest-conversation document sidecars", () =>
    Effect.runPromise(reclaimsRetiredTask));
});

const truncatesTornUtf = Effect.gen(function* () {
  const directory = yield* tempDirectory();
  const storage = yield* openStorage(directory);
  yield* createRoot(storage);
  const documentId = yield* awaited(storage.mintId<DocumentId>());
  yield* awaited(
    storage.commit(
      [
        {
          content: { kind: "base", value: { text: "kept" }, version: 1 },
          record: sessionDocument(documentId),
          type: "document.create",
        },
      ],
      context,
    ),
  );
  const sidecarPath = joinPath(directory, `doc-${documentId}.jsonl`);
  const mainPath = joinPath(directory, "main.jsonl");
  const sidecarSize = yield* fileSize(sidecarPath);
  const mainSize = yield* fileSize(mainPath);
  const torn = new TextEncoder().encode('{"text":"€');
  yield* appendBytes(sidecarPath, torn.subarray(0, torn.length - 1));
  yield* appendBytes(mainPath, torn.subarray(0, torn.length - 1));

  const reopened = yield* openStorage(directory);
  expect(yield* fileSize(sidecarPath)).toBe(sidecarSize);
  expect(yield* fileSize(mainPath)).toBe(mainSize);
  expect(
    yield* awaited(
      reopened.commit(
        [
          {
            content: { kind: "delta", ops: [], version: 1 },
            id: documentId,
            type: "document.change",
          },
        ],
        context,
      ),
    ),
  ).toBe(3);
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("truncates torn UTF-8 tails at exact byte offsets and reuses the unconfirmed sequence", () =>
    Effect.runPromise(truncatesTornUtf));
});

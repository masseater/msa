import type { JsonValue } from "@msa/chord";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { DocumentId, TaskId } from "../src/types.ts";
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
} from "./jsonl-storage-support.ts";
import { appendBytes, fileSize, joinPath, removeDir } from "./platform-support.ts";

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
    id,
    kind: "rewindable",
    scope: { kind: "conversation" as const, conversationId: ROOT_CONVERSATION_ID },
    history: "rewindable" as const,
    fork: "asOf" as const,
  };
  const createdAt = yield* awaited(
    storage.commit(
      [
        {
          type: "document.create",
          record,
          content: { kind: "base", version: 1, value: { count: 0 } },
        },
      ],
      context,
    ),
  );
  const changedAt = yield* awaited(
    storage.commit(
      [
        {
          type: "document.change",
          id,
          content: { kind: "delta", version: 1, ops: [["s", ["count"], 1]] },
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
          id,
          content: { kind: "base", version: 1, value: { count: 2 } },
        },
      ],
      context,
    ),
  );
  return { directory, storage, id, createdAt, changedAt };
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
          type: "document.create",
          record: sessionDocument(sessionId, "session"),
          content: { kind: "base", version: 1, value: {} },
        },
        {
          type: "document.create",
          record: {
            id: latestId,
            kind: "latest",
            scope: { kind: "conversation", conversationId: ROOT_CONVERSATION_ID },
            history: "latest",
            fork: "current",
          },
          content: { kind: "base", version: 1, value: {} },
        },
        {
          type: "document.create",
          record: { id: taskDocumentId, kind: "task", scope: { kind: "task", taskId } },
          content: { kind: "base", version: 1, value: {} },
        },
      ],
      context,
    ),
  );
  const retiredAt = yield* awaited(
    storage.commit(
      [
        { type: "document.retire", id: sessionId },
        { type: "document.retire", id: latestId },
        { type: "document.retire", id: taskDocumentId },
        { type: "task", value: terminalTask(taskId) },
      ],
      context,
    ),
  );
  return { directory, taskId, sessionId, latestId, taskDocumentId, createdAt, retiredAt };
});

const neverReclaimsRewindable = Effect.gen(function* () {
  const { directory, storage, id, createdAt, changedAt } = yield* rewindableHistory();
  yield* awaited(storage.commit([{ type: "document.retire", id }], context));

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
  ).toMatchObject({ id: sessionId, createdAt, retiredAt });
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
          type: "document.create",
          record: sessionDocument(documentId),
          content: { kind: "base", version: 1, value: { text: "kept" } },
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
            type: "document.change",
            id: documentId,
            content: { kind: "delta", version: 1, ops: [] },
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

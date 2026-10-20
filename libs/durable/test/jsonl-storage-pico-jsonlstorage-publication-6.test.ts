import type { JsonValue } from "@msa/chord";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { JsonlStorage } from "../src/storage/jsonl/index.ts";
import type { DocumentId, TaskId } from "../src/types.ts";
import effectSupport from "./effect-support.ts";
import jsonlStorageSupport from "./jsonl-storage-support.ts";
import platformSupport from "./platform-support.ts";

const { awaited, toJsonText } = effectSupport;
const {
  context,
  createRoot,
  fileExists,
  openStorage,
  openStorages,
  pendingTask,
  sessionDocument,
  tempDirectories,
  tempDirectory,
  terminalTask,
} = jsonlStorageSupport;
const { appendText, joinPath, removeDir, writeText } = platformSupport;

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

const removesCompleteUnconfirmed = Effect.gen(function* () {
  const directory = yield* tempDirectory();
  const storage = yield* openStorage(directory);
  yield* createRoot(storage);
  const taskId = yield* awaited(storage.mintId<TaskId<JsonValue>>());
  yield* awaited(storage.commit([{ type: "task", value: pendingTask(taskId) }], context));
  yield* awaited(storage.commit([{ type: "task", value: terminalTask(taskId) }], context));
  const sidecarPath = joinPath(directory, `task-${taskId}.jsonl`);
  expect(yield* fileExists(sidecarPath)).toBe(false);
  yield* appendText(
    sidecarPath,
    `${yield* toJsonText({
      format: 1,
      ordinal: 0,
      payload: { type: "task", value: pendingTask(taskId, "stale") },
      seq: 4,
      type: "record",
    })}\n`,
  );

  const reopened = yield* openStorage(directory);
  expect(yield* fileExists(sidecarPath)).toBe(false);
  expect(yield* awaited(reopened.task(taskId, context))).toEqual(terminalTask(taskId));
  expect(yield* awaited(reopened.commit([], context))).toBe(4);
});

const failsOpenConfirmed = Effect.gen(function* () {
  const directory = yield* tempDirectory();
  const storage = yield* openStorage(directory);
  yield* createRoot(storage);
  const documentId = yield* awaited(storage.mintId<DocumentId>());
  yield* awaited(
    storage.commit(
      [
        {
          content: { kind: "base", value: {}, version: 1 },
          record: sessionDocument(documentId),
          type: "document.create",
        },
      ],
      context,
    ),
  );
  yield* writeText(joinPath(directory, `doc-${documentId}.jsonl`), "");
  yield* awaited(
    expect(
      JsonlStorage.open(directory, new NodeExecutionEnv({ cwd: directory }), context),
    ).rejects.toThrow("Missing confirmed sidecar record"),
  );
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("removes complete unconfirmed sidecar tails without resurrecting terminal tasks", () =>
    Effect.runPromise(removesCompleteUnconfirmed));

  it("fails open when confirmed sidecar data is missing", () =>
    Effect.runPromise(failsOpenConfirmed));
});

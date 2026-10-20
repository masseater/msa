import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { JsonlStorage } from "../src/storage/jsonl/index.ts";
import type { DocumentId } from "../src/types.ts";
import effectSupport from "./effect-support.ts";
import jsonlStorageSupport from "./jsonl-storage-support.ts";
import platformSupport from "./platform-support.ts";

const { awaited, fromJsonText, toJsonText } = effectSupport;
const {
  context,
  createRoot,
  openStorage,
  openStorages,
  readLines,
  sessionDocument,
  tempDirectories,
  tempDirectory,
} = jsonlStorageSupport;
const { appendBytes, appendText, joinPath, readBytes, readText, removeDir, writeText } =
  platformSupport;

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

const rejectsConfirmedRecord = Effect.gen(function* () {
  const directory = yield* tempDirectory();
  const storage = yield* openStorage(directory);
  yield* createRoot(storage);
  const documentId = yield* awaited(storage.mintId<DocumentId>());
  yield* awaited(
    storage.commit(
      [
        {
          content: { kind: "base", value: { count: 0 }, version: 1 },
          record: sessionDocument(documentId),
          type: "document.create",
        },
      ],
      context,
    ),
  );
  yield* awaited(
    storage.commit(
      [
        {
          content: { kind: "delta", ops: [["s", ["count"], 1]], version: 1 },
          id: documentId,
          type: "document.change",
        },
      ],
      context,
    ),
  );
  const path = joinPath(directory, `doc-${documentId}.jsonl`);
  const [first, second] = yield* readLines(path);
  const unconfirmed = yield* toJsonText({
    format: 1,
    ordinal: 999,
    payload: {
      content: { kind: "delta", ops: [], version: 1 },
      id: documentId,
      type: "document",
    },
    seq: 2,
    type: "record",
  });
  yield* writeText(path, `${first}\n${unconfirmed}\n${second}\n`);
  yield* awaited(
    expect(
      JsonlStorage.open(directory, new NodeExecutionEnv({ cwd: directory }), context),
    ).rejects.toThrow("Confirmed record follows an unconfirmed tail"),
  );
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("rejects a confirmed record after an unconfirmed sidecar record", () =>
    Effect.runPromise(rejectsConfirmedRecord));
});

const rejectsNonIncreasing = Effect.gen(function* () {
  const directory = yield* tempDirectory();
  const storage = yield* openStorage(directory);
  yield* createRoot(storage);
  const path = joinPath(directory, "main.jsonl");
  yield* appendBytes(path, yield* readBytes(path));

  yield* awaited(
    expect(
      JsonlStorage.open(directory, new NodeExecutionEnv({ cwd: directory }), context),
    ).rejects.toThrow("Commit sequence does not strictly increase"),
  );
});

const rejectsStructurallyInvalid = Effect.gen(function* () {
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
  const path = joinPath(directory, `doc-${documentId}.jsonl`);
  const record = (yield* fromJsonText((yield* readText(path)).trim())) as {
    payload: { content: Record<string, unknown> };
  };
  delete record.payload.content["value"];
  yield* writeText(path, `${yield* toJsonText(record)}\n`);

  yield* awaited(
    expect(
      JsonlStorage.open(directory, new NodeExecutionEnv({ cwd: directory }), context),
    ).rejects.toThrow("Invalid document content"),
  );
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("rejects non-increasing main commit sequences", () => Effect.runPromise(rejectsNonIncreasing));

  it("rejects structurally invalid confirmed document content", () =>
    Effect.runPromise(rejectsStructurallyInvalid));
});

const rejectsMalformedComplete = Effect.gen(function* () {
  const mainDirectory = yield* tempDirectory();
  const mainStorage = yield* openStorage(mainDirectory);
  yield* createRoot(mainStorage);
  yield* appendText(joinPath(mainDirectory, "main.jsonl"), "{bad}\n");
  yield* awaited(
    expect(
      JsonlStorage.open(mainDirectory, new NodeExecutionEnv({ cwd: mainDirectory }), context),
    ).rejects.toThrow("Malformed complete main.jsonl"),
  );

  const sidecarDirectory = yield* tempDirectory();
  const sidecarStorage = yield* openStorage(sidecarDirectory);
  yield* createRoot(sidecarStorage);
  yield* writeText(joinPath(sidecarDirectory, "doc-99.jsonl"), "{bad}\n");
  yield* awaited(
    expect(
      JsonlStorage.open(sidecarDirectory, new NodeExecutionEnv({ cwd: sidecarDirectory }), context),
    ).rejects.toThrow("Malformed complete doc-99.jsonl"),
  );
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("rejects malformed complete main and sidecar lines", () =>
    Effect.runPromise(rejectsMalformedComplete));
});

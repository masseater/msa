import { readFile, writeFile } from "node:fs/promises";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { JsonlStorage } from "../src/storage/jsonl/index.ts";
import type { DocumentId } from "../src/types.ts";
import { toJsonText, fromJsonText, awaited } from "./effect-support.ts";
import {
  readLines,
  sessionDocument,
  createRoot,
  context,
  openStorage,
  openStorages,
  tempDirectories,
  tempDirectory,
} from "./jsonl-storage-support.ts";
import { joinPath, removeDir } from "./platform-support.ts";

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
          type: "document.create",
          record: sessionDocument(documentId),
          content: { kind: "base", version: 1, value: { count: 0 } },
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
          id: documentId,
          content: { kind: "delta", version: 1, ops: [["s", ["count"], 1]] },
        },
      ],
      context,
    ),
  );
  const path = joinPath(directory, `doc-${documentId}.jsonl`);
  const [first, second] = yield* readLines(path);
  const unconfirmed = yield* toJsonText({
    format: 1,
    type: "record",
    seq: 2,
    ordinal: 999,
    payload: {
      type: "document",
      id: documentId,
      content: { kind: "delta", version: 1, ops: [] },
    },
  });
  yield* awaited(writeFile(path, `${first}\n${unconfirmed}\n${second}\n`));
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
  yield* awaited(writeFile(path, yield* awaited(readFile(path)), { flag: "a" }));

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
          type: "document.create",
          record: sessionDocument(documentId),
          content: { kind: "base", version: 1, value: {} },
        },
      ],
      context,
    ),
  );
  const path = joinPath(directory, `doc-${documentId}.jsonl`);
  const record = (yield* fromJsonText((yield* awaited(readFile(path, "utf8"))).trim())) as {
    payload: { content: Record<string, unknown> };
  };
  delete record.payload.content["value"];
  yield* awaited(writeFile(path, `${yield* toJsonText(record)}\n`));

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
  yield* awaited(writeFile(joinPath(mainDirectory, "main.jsonl"), "{bad}\n", { flag: "a" }));
  yield* awaited(
    expect(
      JsonlStorage.open(mainDirectory, new NodeExecutionEnv({ cwd: mainDirectory }), context),
    ).rejects.toThrow("Malformed complete main.jsonl"),
  );

  const sidecarDirectory = yield* tempDirectory();
  const sidecarStorage = yield* openStorage(sidecarDirectory);
  yield* createRoot(sidecarStorage);
  yield* awaited(writeFile(joinPath(sidecarDirectory, "doc-99.jsonl"), "{bad}\n"));
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

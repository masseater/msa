import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { DocumentId } from "../src/types.ts";
import { awaited } from "./effect-support.ts";
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

const appendsLaterDeltas = Effect.gen(function* () {
  const directory = yield* tempDirectory();
  const storage = yield* openStorage(directory);
  yield* createRoot(storage);
  const id = yield* awaited(storage.mintId<DocumentId>());
  yield* awaited(
    storage.commit(
      [
        {
          type: "document.create",
          record: sessionDocument(id),
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
          id,
          content: { kind: "base", version: 1, value: { count: 10 } },
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
          content: { kind: "delta", version: 1, ops: [["s", ["count"], 11]] },
        },
      ],
      context,
    ),
  );
  expect(yield* readLines(joinPath(directory, `doc-${id}.jsonl`))).toHaveLength(2);
  const reopened = yield* openStorage(directory);
  expect((yield* awaited(reopened.document(id, "current", context)))?.value).toEqual({
    count: 11,
  });
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("appends later deltas to the replacement sidecar after a current-only base", () =>
    Effect.runPromise(appendsLaterDeltas));
});

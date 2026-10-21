import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type typesModule from "../src/types.types.ts";
import effectSupport from "./effect-support.ts";
import jsonlStorageSupport from "./jsonl-storage-support.ts";
import type jsonlStorageSupportTypes from "./jsonl-storage-support.types.ts";
import platformSupport from "./platform-support.ts";

const { awaited } = effectSupport;
const {
  InstrumentedEnv,
  context,
  createRoot,
  openStorage,
  openStorages,
  readLines,
  sessionDocument,
  tempDirectories,
  tempDirectory,
} = jsonlStorageSupport;
const { joinPath, listDirectory, removeDir } = platformSupport;

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

const documentWithDelta = Effect.fn("documentWithDelta")(function* () {
  const directory = yield* tempDirectory();
  const env = new InstrumentedEnv({ cwd: directory });
  const storage = yield* openStorage(directory, env);
  yield* createRoot(storage);
  const id = yield* awaited(storage.mintId<typesModule.DocumentId>());
  yield* awaited(
    storage.commit(
      [
        {
          content: { kind: "base", value: { count: 0 }, version: 1 },
          record: sessionDocument(id),
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
          id,
          type: "document.change",
        },
      ],
      context,
    ),
  );
  return { directory, env, id, storage };
});

describe("Pico JsonlStorage publication and recovery", () => {
  for (const failure of [
    { call: 1, mode: "before", operation: "write" },
    { call: 1, mode: "short", operation: "write" },
    { call: 1, mode: "after", operation: "write" },
    { call: 1, mode: "before", operation: "rename" },
    { call: 1, mode: "after", operation: "rename" },
  ] as const satisfies readonly jsonlStorageSupportTypes.Failure[]) {
    it(`recovers a committed base across reclaim ${failure.operation} ${failure.mode}`, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const { directory, env, storage, id } = yield* documentWithDelta();

          env.fail(failure);
          yield* awaited(
            expect(
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
            ).resolves.toBe(4),
          );
          expect((yield* awaited(storage.document(id, "current", context)))?.value).toEqual({
            count: 2,
          });
          yield* awaited(storage.close(context));

          const reopened = yield* openStorage(directory);
          expect((yield* awaited(reopened.document(id, "current", context)))?.value).toEqual({
            count: 2,
          });
          expect(yield* readLines(joinPath(directory, `doc-${id}.jsonl`))).toHaveLength(1);
          expect(
            (yield* listDirectory(directory)).filter((name) => name.endsWith(".reclaim")),
          ).toEqual([]);
        }),
      ));
  }
});

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
  InstrumentedEnv,
  type Failure,
} from "./jsonl-storage-support.ts";
import { listDirectory, joinPath, removeDir } from "./platform-support.ts";

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
          content: { kind: "delta", version: 1, ops: [["s", ["count"], 1]] },
        },
      ],
      context,
    ),
  );
  return { directory, env, storage, id };
});

describe("Pico JsonlStorage publication and recovery", () => {
  for (const failure of [
    { operation: "write", call: 1, mode: "before" },
    { operation: "write", call: 1, mode: "short" },
    { operation: "write", call: 1, mode: "after" },
    { operation: "rename", call: 1, mode: "before" },
    { operation: "rename", call: 1, mode: "after" },
  ] as const satisfies readonly Failure[]) {
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
                    type: "document.change",
                    id,
                    content: { kind: "base", version: 1, value: { count: 2 } },
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

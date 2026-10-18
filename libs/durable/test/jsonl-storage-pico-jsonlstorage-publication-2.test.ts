import type { JsonValue } from "@msa/chord";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import type { DocumentId, TaskId } from "../src/types.ts";
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
  InstrumentedEnv,
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

const instrumentedDocument = Effect.fn("instrumentedDocument")(function* () {
  const directory = yield* tempDirectory();
  const env = new InstrumentedEnv({ cwd: directory });
  const storage = yield* openStorage(directory, env, { fsync: true });
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
  return { directory, env, storage, id };
});

const fsyncedDocument = Effect.fn("fsyncedDocument")(function* () {
  const directory = yield* tempDirectory();
  const env = new InstrumentedEnv({ cwd: directory });
  const storage = yield* openStorage(directory, env, { fsync: true });
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
  return { directory, env, storage, id };
});

const recoversDocumentRetirementCases = ["before", "after"] as const;

const recoversDocumentRetirement = Effect.fn("recoversDocumentRetirement")(function* (
  mode: (typeof recoversDocumentRetirementCases)[number],
) {
  const directory = yield* tempDirectory();
  const env = new InstrumentedEnv({ cwd: directory });
  const storage = yield* openStorage(directory, env);
  yield* createRoot(storage);
  const taskId = yield* awaited(storage.mintId<TaskId<JsonValue>>());
  const id = yield* awaited(storage.mintId<DocumentId>());
  yield* awaited(
    storage.commit(
      [
        { type: "task", value: pendingTask(taskId) },
        {
          type: "document.create",
          record: { id, kind: "task.document", scope: { kind: "task", taskId } },
          content: { kind: "base", version: 1, value: { count: 1 } },
        },
      ],
      context,
    ),
  );
  env.fail({ operation: "remove", call: 1, mode });
  yield* awaited(
    expect(storage.commit([{ type: "document.retire", id }], context)).resolves.toBe(3),
  );
  expect(yield* awaited(storage.document(id, "current", context))).toBeUndefined();
  yield* awaited(storage.close(context));

  const reopened = yield* openStorage(directory);
  expect(yield* awaited(reopened.document(id, "current", context))).toBeUndefined();
  expect(yield* awaited(reopened.task(taskId, context))).toEqual(pendingTask(taskId));
  expect(yield* fileExists(joinPath(directory, `doc-${id}.jsonl`))).toBe(false);
  expect((yield* listDirectory(directory)).filter((name) => name.endsWith(".reclaim"))).toEqual([]);
});

describe("Pico JsonlStorage publication and recovery", () => {
  for (const mode of recoversDocumentRetirementCases) {
    it(`recovers document-retirement reclamation across remove ${mode}`, () =>
      Effect.runPromise(recoversDocumentRetirement(mode)));
  }
});

const defersReclamationAuthorizingCases = ["before", "after"] as const;

const defersReclamationAuthorizing = Effect.fn("defersReclamationAuthorizing")(function* (
  mode: (typeof defersReclamationAuthorizingCases)[number],
) {
  const { directory, env, storage, id } = yield* instrumentedDocument();
  env.fail({ operation: "flush", call: 2, mode });
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
    ).resolves.toBe(3),
  );
  expect(env.operations).toEqual([
    `append:doc-${id}.jsonl`,
    `flush:doc-${id}.jsonl`,
    "append:main.jsonl",
    "flush:main.jsonl",
  ]);
  expect((yield* awaited(storage.document(id, "current", context)))?.value).toEqual({
    count: 2,
  });
  expect(yield* readLines(joinPath(directory, `doc-${id}.jsonl`))).toHaveLength(2);
  yield* awaited(storage.close(context));

  const recoveryEnv = new InstrumentedEnv({ cwd: directory });
  recoveryEnv.fail({ operation: "flush", call: 1, mode });
  const deferred = yield* openStorage(directory, recoveryEnv, { fsync: true });
  expect((yield* awaited(deferred.document(id, "current", context)))?.value).toEqual({
    count: 2,
  });
  expect(recoveryEnv.operations).toEqual(["flush:main.jsonl"]);
  expect(yield* readLines(joinPath(directory, `doc-${id}.jsonl`))).toHaveLength(2);
  yield* awaited(deferred.close(context));

  const reclaimed = yield* openStorage(directory, new NodeExecutionEnv({ cwd: directory }), {
    fsync: true,
  });
  expect((yield* awaited(reclaimed.document(id, "current", context)))?.value).toEqual({
    count: 2,
  });
  expect(yield* readLines(joinPath(directory, `doc-${id}.jsonl`))).toHaveLength(1);
});

describe("Pico JsonlStorage publication and recovery", () => {
  for (const mode of defersReclamationAuthorizingCases) {
    it(`defers reclamation after authorizing-main flush ${mode} failure`, () =>
      Effect.runPromise(defersReclamationAuthorizing(mode)));
  }
});

const keepsCommittedBaseCases = ["before", "after"] as const;

const keepsCommittedBase = Effect.fn("keepsCommittedBase")(function* (
  mode: (typeof keepsCommittedBaseCases)[number],
) {
  const { directory, env, storage, id } = yield* fsyncedDocument();
  env.fail({ operation: "flush", call: 3, mode });
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
    ).resolves.toBe(3),
  );
  env.clear();
  yield* awaited(
    storage.commit(
      [
        {
          type: "document.change",
          id,
          content: { kind: "delta", version: 1, ops: [["s", ["count"], 3]] },
        },
      ],
      context,
    ),
  );
  yield* awaited(storage.close(context));

  const reopened = yield* openStorage(directory, new NodeExecutionEnv({ cwd: directory }), {
    fsync: true,
  });
  expect((yield* awaited(reopened.document(id, "current", context)))?.value).toEqual({
    count: 3,
  });
  expect(yield* readLines(joinPath(directory, `doc-${id}.jsonl`))).toHaveLength(2);
});

describe("Pico JsonlStorage publication and recovery", () => {
  for (const mode of keepsCommittedBaseCases) {
    it(`keeps a committed base usable after reclaim-temp flush ${mode} failure`, () =>
      Effect.runPromise(keepsCommittedBase(mode)));
  }
});

const recoversTerminalTaskCases = ["before", "after"] as const;

const recoversTerminalTask = Effect.fn("recoversTerminalTask")(function* (
  mode: (typeof recoversTerminalTaskCases)[number],
) {
  const directory = yield* tempDirectory();
  const env = new InstrumentedEnv({ cwd: directory });
  const storage = yield* openStorage(directory, env);
  yield* createRoot(storage);
  const id = yield* awaited(storage.mintId<TaskId<JsonValue>>());
  yield* awaited(storage.commit([{ type: "task", value: pendingTask(id) }], context));
  env.fail({ operation: "remove", call: 1, mode });
  yield* awaited(
    expect(storage.commit([{ type: "task", value: terminalTask(id) }], context)).resolves.toBe(3),
  );
  expect(yield* awaited(storage.task(id, context))).toEqual(terminalTask(id));
  yield* awaited(storage.close(context));

  const reopened = yield* openStorage(directory);
  expect(yield* awaited(reopened.task(id, context))).toEqual(terminalTask(id));
  expect(yield* fileExists(joinPath(directory, `task-${id}.jsonl`))).toBe(false);
  expect((yield* listDirectory(directory)).filter((name) => name.endsWith(".reclaim"))).toEqual([]);
});

describe("Pico JsonlStorage publication and recovery", () => {
  for (const mode of recoversTerminalTaskCases) {
    it(`recovers terminal-task reclamation across remove ${mode}`, () =>
      Effect.runPromise(recoversTerminalTask(mode)));
  }
});

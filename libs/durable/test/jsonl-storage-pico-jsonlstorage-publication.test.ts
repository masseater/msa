import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import type { JsonValue } from "@msa/chord";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { DocumentId, EntryId, TaskId } from "../src/types.ts";
import { ROOT_CONVERSATION_ID } from "../src/types.ts";
import {
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
  type Failure,
} from "./jsonl-storage-support.ts";

afterEach(async () => {
  for await (const storage of openStorages) await storage.close(context);
  openStorages.clear();
  for await (const directory of tempDirectories)
    await rm(directory, { recursive: true, force: true });
  tempDirectories.clear();
});

// Create two documents in one commit and check the flush order of their sidecars and main.
async function expectCreateFlushOrder(fsync: boolean) {
  const directory = await tempDirectory();
  const env = new InstrumentedEnv({ cwd: directory });
  const storage = await openStorage(directory, env, { fsync });
  await createRoot(storage);
  const firstId = await storage.mintId<DocumentId>();
  const secondId = await storage.mintId<DocumentId>();
  env.clear();
  await storage.commit(
    [
      {
        type: "document.create",
        record: sessionDocument(secondId, "second"),
        content: { kind: "base", version: 1, value: {} },
      },
      {
        type: "document.create",
        record: sessionDocument(firstId, "first"),
        content: { kind: "base", version: 1, value: {} },
      },
    ],
    context,
  );
  const expected = [
    `append:doc-${secondId}.jsonl`,
    `append:doc-${firstId}.jsonl`,
    ...(fsync ? [`flush:doc-${secondId}.jsonl`, `flush:doc-${firstId}.jsonl`] : []),
    "append:main.jsonl",
  ];
  expect(env.operations).toEqual(expected);
  return { env, storage, firstId };
}

type FlushOrderStore = Awaited<ReturnType<typeof expectCreateFlushOrder>>;

// A base change reclaims the sidecar only after main is flushed; an entry alone touches main only.
async function expectReclaimFlushOrder(
  { env, storage, firstId }: FlushOrderStore,
  fsync: boolean,
): Promise<void> {
  env.clear();
  await storage.commit(
    [
      {
        type: "document.change",
        id: firstId,
        content: { kind: "base", version: 1, value: { checkpoint: true } },
      },
    ],
    context,
  );
  expect(env.operations).toEqual([
    `append:doc-${firstId}.jsonl`,
    ...(fsync ? [`flush:doc-${firstId}.jsonl`] : []),
    "append:main.jsonl",
    ...(fsync ? ["flush:main.jsonl"] : []),
    `write:doc-${firstId}.jsonl.reclaim`,
    ...(fsync ? [`flush:doc-${firstId}.jsonl.reclaim`] : []),
    `rename:doc-${firstId}.jsonl.reclaim->doc-${firstId}.jsonl`,
  ]);

  env.clear();
  await storage.commit(
    [
      {
        type: "entry",
        value: {
          id: await storage.mintId<EntryId>(),
          conversationId: ROOT_CONVERSATION_ID,
          kind: "main-only",
        },
      },
    ],
    context,
  );
  expect(env.operations).toEqual(["append:main.jsonl"]);
}

// A terminal task's sidecar is removed only after main is flushed.
async function expectTaskSidecarRemoval({ env, storage }: FlushOrderStore, fsync: boolean) {
  const taskId = await storage.mintId<TaskId<JsonValue>>();
  await storage.commit([{ type: "task", value: pendingTask(taskId) }], context);
  env.clear();
  await storage.commit([{ type: "task", value: terminalTask(taskId) }], context);
  expect(env.operations).toEqual([
    "append:main.jsonl",
    ...(fsync ? ["flush:main.jsonl"] : []),
    `remove:task-${taskId}.jsonl`,
  ]);
}

async function documentWithDelta() {
  const directory = await tempDirectory();
  const env = new InstrumentedEnv({ cwd: directory });
  const storage = await openStorage(directory, env);
  await createRoot(storage);
  const id = await storage.mintId<DocumentId>();
  await storage.commit(
    [
      {
        type: "document.create",
        record: sessionDocument(id),
        content: { kind: "base", version: 1, value: { count: 0 } },
      },
    ],
    context,
  );
  await storage.commit(
    [
      {
        type: "document.change",
        id,
        content: { kind: "delta", version: 1, ops: [["s", ["count"], 1]] },
      },
    ],
    context,
  );
  return { directory, env, storage, id };
}

describe("Pico JsonlStorage publication and recovery", () => {
  for (const failure of [
    { operation: "append", call: 1, mode: "before" },
    { operation: "append", call: 1, mode: "after" },
    { operation: "append", call: 1, mode: "short" },
    { operation: "append", call: 2, mode: "before" },
    { operation: "append", call: 2, mode: "after" },
    { operation: "append", call: 3, mode: "before" },
    { operation: "append", call: 3, mode: "short" },
    { operation: "append", call: 3, mode: "after" },
  ] as const satisfies readonly Failure[]) {
    it(`poisons after ${failure.mode} failure at append ${failure.call} and recovers only confirmed state`, async () => {
      const directory = await tempDirectory();
      const env = new InstrumentedEnv({ cwd: directory });
      const storage = await openStorage(directory, env);
      await createRoot(storage);
      const firstId = await storage.mintId<DocumentId>();
      const secondId = await storage.mintId<DocumentId>();
      env.fail(failure);
      await expect(
        storage.commit(
          [
            {
              type: "document.create",
              record: sessionDocument(firstId, "first"),
              content: { kind: "base", version: 1, value: { text: "α" } },
            },
            {
              type: "document.create",
              record: sessionDocument(secondId, "second"),
              content: { kind: "base", version: 1, value: { text: "β" } },
            },
          ],
          context,
        ),
      ).rejects.toThrow("poisoned");
      await expect(storage.document(firstId, "current", context)).rejects.toThrow("poisoned");

      const reopened = await openStorage(directory);
      const markerSurvived = failure.call === 3 && failure.mode === "after";
      expect(await reopened.document(firstId, "current", context)).toEqual(
        markerSurvived ? expect.objectContaining({ value: { text: "α" } }) : undefined,
      );
      expect(await reopened.document(secondId, "current", context)).toEqual(
        markerSurvived ? expect.objectContaining({ value: { text: "β" } }) : undefined,
      );
    });
  }
});

describe("Pico JsonlStorage publication and recovery", () => {
  for (const failure of [
    { operation: "flush", call: 1, mode: "before" },
    { operation: "flush", call: 1, mode: "after" },
    { operation: "flush", call: 2, mode: "before" },
    { operation: "flush", call: 2, mode: "after" },
  ] as const satisfies readonly Failure[]) {
    it(`poisons after ${failure.mode} failure at flush ${failure.call} and never writes a marker`, async () => {
      const directory = await tempDirectory();
      const env = new InstrumentedEnv({ cwd: directory });
      const storage = await openStorage(directory, env, { fsync: true });
      await createRoot(storage);
      const firstId = await storage.mintId<DocumentId>();
      const secondId = await storage.mintId<DocumentId>();
      env.fail(failure);
      await expect(
        storage.commit(
          [
            {
              type: "document.create",
              record: sessionDocument(firstId, "flush.first"),
              content: { kind: "base", version: 1, value: {} },
            },
            {
              type: "document.create",
              record: sessionDocument(secondId, "flush.second"),
              content: { kind: "base", version: 1, value: {} },
            },
          ],
          context,
        ),
      ).rejects.toThrow("poisoned");
      const reopened = await openStorage(directory);
      expect(await reopened.document(firstId, "current", context)).toBeUndefined();
      expect(await reopened.document(secondId, "current", context)).toBeUndefined();
    });
  }

  it("orders publication flushes exactly and flushes main only to authorize reclamation", async () => {
    for await (const fsync of [false, true]) {
      const store = await expectCreateFlushOrder(fsync);
      await expectReclaimFlushOrder(store, fsync);
      await expectTaskSidecarRemoval(store, fsync);
    }
  });
});

describe("Pico JsonlStorage publication and recovery", () => {
  for (const failure of [
    { operation: "write", call: 1, mode: "before" },
    { operation: "write", call: 1, mode: "short" },
    { operation: "write", call: 1, mode: "after" },
    { operation: "rename", call: 1, mode: "before" },
    { operation: "rename", call: 1, mode: "after" },
  ] as const satisfies readonly Failure[]) {
    it(`recovers a committed base across reclaim ${failure.operation} ${failure.mode}`, async () => {
      const { directory, env, storage, id } = await documentWithDelta();

      env.fail(failure);
      await expect(
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
      ).resolves.toBe(4);
      expect((await storage.document(id, "current", context))?.value).toEqual({ count: 2 });
      await storage.close(context);

      const reopened = await openStorage(directory);
      expect((await reopened.document(id, "current", context))?.value).toEqual({ count: 2 });
      expect(await readLines(join(directory, `doc-${id}.jsonl`))).toHaveLength(1);
      expect((await readdir(directory)).filter((name) => name.endsWith(".reclaim"))).toEqual([]);
    });
  }
});

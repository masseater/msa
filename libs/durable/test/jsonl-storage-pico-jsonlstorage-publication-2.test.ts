import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import type { JsonValue } from "@msa/chord";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import type { DocumentId, TaskId } from "../src/types.ts";
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

afterEach(async () => {
  for await (const storage of openStorages) await storage.close(context);
  openStorages.clear();
  for await (const directory of tempDirectories)
    await rm(directory, { recursive: true, force: true });
  tempDirectories.clear();
});

async function instrumentedDocument() {
  const directory = await tempDirectory();
  const env = new InstrumentedEnv({ cwd: directory });
  const storage = await openStorage(directory, env, { fsync: true });
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
  return { directory, env, storage, id };
}

async function fsyncedDocument() {
  const directory = await tempDirectory();
  const env = new InstrumentedEnv({ cwd: directory });
  const storage = await openStorage(directory, env, { fsync: true });
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
  return { directory, env, storage, id };
}

describe("Pico JsonlStorage publication and recovery", () => {
  for (const mode of ["before", "after"] as const) {
    it(`recovers document-retirement reclamation across remove ${mode}`, async () => {
      const directory = await tempDirectory();
      const env = new InstrumentedEnv({ cwd: directory });
      const storage = await openStorage(directory, env);
      await createRoot(storage);
      const taskId = await storage.mintId<TaskId<JsonValue>>();
      const id = await storage.mintId<DocumentId>();
      await storage.commit(
        [
          { type: "task", value: pendingTask(taskId) },
          {
            type: "document.create",
            record: { id, kind: "task.document", scope: { kind: "task", taskId } },
            content: { kind: "base", version: 1, value: { count: 1 } },
          },
        ],
        context,
      );
      env.fail({ operation: "remove", call: 1, mode });
      await expect(storage.commit([{ type: "document.retire", id }], context)).resolves.toBe(3);
      expect(await storage.document(id, "current", context)).toBeUndefined();
      await storage.close(context);

      const reopened = await openStorage(directory);
      expect(await reopened.document(id, "current", context)).toBeUndefined();
      expect(await reopened.task(taskId, context)).toEqual(pendingTask(taskId));
      expect(await fileExists(join(directory, `doc-${id}.jsonl`))).toBe(false);
      expect((await readdir(directory)).filter((name) => name.endsWith(".reclaim"))).toEqual([]);
    });
  }
});

describe("Pico JsonlStorage publication and recovery", () => {
  for (const mode of ["before", "after"] as const) {
    it(`defers reclamation after authorizing-main flush ${mode} failure`, async () => {
      const { directory, env, storage, id } = await instrumentedDocument();
      env.fail({ operation: "flush", call: 2, mode });
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
      ).resolves.toBe(3);
      expect(env.operations).toEqual([
        `append:doc-${id}.jsonl`,
        `flush:doc-${id}.jsonl`,
        "append:main.jsonl",
        "flush:main.jsonl",
      ]);
      expect((await storage.document(id, "current", context))?.value).toEqual({ count: 2 });
      expect(await readLines(join(directory, `doc-${id}.jsonl`))).toHaveLength(2);
      await storage.close(context);

      const recoveryEnv = new InstrumentedEnv({ cwd: directory });
      recoveryEnv.fail({ operation: "flush", call: 1, mode });
      const deferred = await openStorage(directory, recoveryEnv, { fsync: true });
      expect((await deferred.document(id, "current", context))?.value).toEqual({ count: 2 });
      expect(recoveryEnv.operations).toEqual(["flush:main.jsonl"]);
      expect(await readLines(join(directory, `doc-${id}.jsonl`))).toHaveLength(2);
      await deferred.close(context);

      const reclaimed = await openStorage(directory, new NodeExecutionEnv({ cwd: directory }), {
        fsync: true,
      });
      expect((await reclaimed.document(id, "current", context))?.value).toEqual({ count: 2 });
      expect(await readLines(join(directory, `doc-${id}.jsonl`))).toHaveLength(1);
    });
  }
});

describe("Pico JsonlStorage publication and recovery", () => {
  for (const mode of ["before", "after"] as const) {
    it(`keeps a committed base usable after reclaim-temp flush ${mode} failure`, async () => {
      const { directory, env, storage, id } = await fsyncedDocument();
      env.fail({ operation: "flush", call: 3, mode });
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
      ).resolves.toBe(3);
      env.clear();
      await storage.commit(
        [
          {
            type: "document.change",
            id,
            content: { kind: "delta", version: 1, ops: [["s", ["count"], 3]] },
          },
        ],
        context,
      );
      await storage.close(context);

      const reopened = await openStorage(directory, new NodeExecutionEnv({ cwd: directory }), {
        fsync: true,
      });
      expect((await reopened.document(id, "current", context))?.value).toEqual({ count: 3 });
      expect(await readLines(join(directory, `doc-${id}.jsonl`))).toHaveLength(2);
    });
  }
});

describe("Pico JsonlStorage publication and recovery", () => {
  for (const mode of ["before", "after"] as const) {
    it(`recovers terminal-task reclamation across remove ${mode}`, async () => {
      const directory = await tempDirectory();
      const env = new InstrumentedEnv({ cwd: directory });
      const storage = await openStorage(directory, env);
      await createRoot(storage);
      const id = await storage.mintId<TaskId<JsonValue>>();
      await storage.commit([{ type: "task", value: pendingTask(id) }], context);
      env.fail({ operation: "remove", call: 1, mode });
      await expect(
        storage.commit([{ type: "task", value: terminalTask(id) }], context),
      ).resolves.toBe(3);
      expect(await storage.task(id, context)).toEqual(terminalTask(id));
      await storage.close(context);

      const reopened = await openStorage(directory);
      expect(await reopened.task(id, context)).toEqual(terminalTask(id));
      expect(await fileExists(join(directory, `task-${id}.jsonl`))).toBe(false);
      expect((await readdir(directory)).filter((name) => name.endsWith(".reclaim"))).toEqual([]);
    });
  }
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("appends later deltas to the replacement sidecar after a current-only base", async () => {
    const directory = await tempDirectory();
    const storage = await openStorage(directory);
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
          content: { kind: "base", version: 1, value: { count: 10 } },
        },
      ],
      context,
    );
    await storage.commit(
      [
        {
          type: "document.change",
          id,
          content: { kind: "delta", version: 1, ops: [["s", ["count"], 11]] },
        },
      ],
      context,
    );
    expect(await readLines(join(directory, `doc-${id}.jsonl`))).toHaveLength(2);
    const reopened = await openStorage(directory);
    expect((await reopened.document(id, "current", context))?.value).toEqual({ count: 11 });
  });
});

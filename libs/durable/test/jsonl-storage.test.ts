import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { JsonValue } from "@msa/chord";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeJsonlStorage } from "../src/storage/jsonl/node.ts";
import type { DocumentId, EntryId, TaskId } from "../src/types.ts";
import { ROOT_CONVERSATION_ID } from "../src/types.ts";
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
import { removeDir } from "./temp-support.ts";

afterEach(async () => {
  for await (const storage of openStorages) await storage.close(context);
  openStorages.clear();
  for await (const directory of tempDirectories) await removeDir(directory);
  tempDirectories.clear();
});

async function sidecarsBeforeReclamation() {
  const directory = await tempDirectory();
  const storage = await openStorage(directory);
  await createRoot(storage);
  const taskId = await storage.mintId<TaskId<JsonValue>>();
  const documentId = await storage.mintId<DocumentId>();
  await storage.commit([{ type: "task", value: pendingTask(taskId) }], context);
  await storage.commit(
    [
      {
        type: "document.create",
        record: sessionDocument(documentId),
        content: { kind: "base", version: 1, value: { count: 0 } },
      },
    ],
    context,
  );
  await storage.commit(
    [
      {
        type: "document.change",
        id: documentId,
        content: { kind: "delta", version: 1, ops: [] },
      },
    ],
    context,
  );
  await storage.commit(
    [
      {
        type: "document.change",
        id: documentId,
        content: { kind: "base", version: 1, value: { count: 1 } },
      },
    ],
    context,
  );
  return { directory, storage, taskId, documentId };
}

describe("Pico JsonlStorage publication and recovery", () => {
  it("opens through the Node adapter", async () => {
    const storage = await openNodeJsonlStorage(await tempDirectory(), context);
    openStorages.add(storage);
    await createRoot(storage);
    expect(await storage.conversation(ROOT_CONVERSATION_ID, context)).toEqual({
      id: ROOT_CONVERSATION_ID,
    });
  });

  it("publishes every commit before reclaiming current-only document and terminal-task sidecars", async () => {
    const { directory, storage, taskId, documentId } = await sidecarsBeforeReclamation();
    expect(await readLines(join(directory, `task-${taskId}.jsonl`))).toHaveLength(1);
    expect(await readLines(join(directory, `doc-${documentId}.jsonl`))).toHaveLength(1);

    await storage.commit([{ type: "document.retire", id: documentId }], context);
    await storage.commit([{ type: "task", value: terminalTask(taskId) }], context);

    expect(await readLines(join(directory, "main.jsonl"))).toHaveLength(7);
    expect(await fileExists(join(directory, `task-${taskId}.jsonl`))).toBe(false);
    expect(await fileExists(join(directory, `doc-${documentId}.jsonl`))).toBe(false);
    const markerTypes = (await readLines(join(directory, "main.jsonl"))).map(
      (line) => (JSON.parse(line) as { readonly type: string }).type,
    );
    expect(markerTypes).toEqual([
      "commit",
      "commit",
      "commit",
      "commit",
      "commit",
      "commit",
      "commit",
    ]);
  });
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("orders multiple live-task replacements in one sidecar by commit ordinal", async () => {
    const directory = await tempDirectory();
    const storage = await openStorage(directory);
    await createRoot(storage);
    const taskId = await storage.mintId<TaskId<JsonValue>>();
    await storage.commit(
      [
        { type: "task", value: pendingTask(taskId, "first") },
        { type: "task", value: pendingTask(taskId, "second") },
      ],
      context,
    );
    expect(await readLines(join(directory, `task-${taskId}.jsonl`))).toHaveLength(2);

    const reopened = await openStorage(directory);
    expect(await reopened.task(taskId, context)).toEqual(pendingTask(taskId, "second"));
  });

  it("removes a complete-plus-torn unconfirmed multi-record sidecar append", async () => {
    const directory = await tempDirectory();
    const env = new InstrumentedEnv({ cwd: directory });
    const storage = await openStorage(directory, env);
    await createRoot(storage);
    const taskId = await storage.mintId<TaskId<JsonValue>>();
    env.fail({ operation: "append", call: 1, mode: "short" });
    await expect(
      storage.commit(
        [
          { type: "task", value: pendingTask(taskId, "first") },
          { type: "task", value: pendingTask(taskId, `second-${"x".repeat(512)}`) },
        ],
        context,
      ),
    ).rejects.toThrow("poisoned");
    const partial = await readFile(join(directory, `task-${taskId}.jsonl`));
    expect(partial.at(-1)).not.toBe(0x0a);
    expect([...partial].filter((byte) => byte === 0x0a)).toHaveLength(1);

    const reopened = await openStorage(directory);
    expect(await reopened.task(taskId, context)).toBeUndefined();
    expect((await stat(join(directory, `task-${taskId}.jsonl`))).size).toBe(0);
  });
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("serializes the complete candidate before I/O and leaves preparation failures usable", async () => {
    const directory = await tempDirectory();
    const env = new InstrumentedEnv({ cwd: directory });
    const storage = await openStorage(directory, env);
    await createRoot(storage);
    env.clear();
    const id = await storage.mintId<EntryId>();
    await expect(
      storage.commit(
        [
          {
            type: "entry",
            value: {
              id,
              conversationId: ROOT_CONVERSATION_ID,
              kind: "bad",
              data: 1n as unknown as JsonValue,
            },
          },
        ],
        context,
      ),
    ).rejects.toThrow();
    expect(env.operations).toEqual([]);
    expect(await storage.entry(id, context)).toBeUndefined();
    expect(
      await storage.commit(
        [{ type: "entry", value: { id, conversationId: ROOT_CONVERSATION_ID, kind: "good" } }],
        context,
      ),
    ).toBe(2);
  });
});

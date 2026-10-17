import { rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { JsonValue } from "@msa/chord";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { JsonlStorage } from "../src/storage/jsonl/index.ts";
import type { DocumentId, TaskId } from "../src/types.ts";
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
} from "./jsonl-storage-support.ts";

afterEach(async () => {
  for await (const storage of openStorages) await storage.close(context);
  openStorages.clear();
  for await (const directory of tempDirectories)
    await rm(directory, { recursive: true, force: true });
  tempDirectories.clear();
});

async function rewindableHistory() {
  const directory = await tempDirectory();
  const storage = await openStorage(directory);
  await createRoot(storage);
  const id = await storage.mintId<DocumentId>();
  const record = {
    id,
    kind: "rewindable",
    scope: { kind: "conversation" as const, conversationId: ROOT_CONVERSATION_ID },
    history: "rewindable" as const,
    fork: "asOf" as const,
  };
  const createdAt = await storage.commit(
    [
      {
        type: "document.create",
        record,
        content: { kind: "base", version: 1, value: { count: 0 } },
      },
    ],
    context,
  );
  const changedAt = await storage.commit(
    [
      {
        type: "document.change",
        id,
        content: { kind: "delta", version: 1, ops: [["s", ["count"], 1]] },
      },
    ],
    context,
  );
  await storage.commit(
    [
      {
        type: "document.change",
        id,
        content: { kind: "base", version: 1, value: { count: 2 } },
      },
    ],
    context,
  );
  return { directory, storage, id, createdAt, changedAt };
}

async function retiredSidecars() {
  const directory = await tempDirectory();
  const storage = await openStorage(directory);
  await createRoot(storage);
  const taskId = await storage.mintId<TaskId<JsonValue>>();
  const sessionId = await storage.mintId<DocumentId>();
  const latestId = await storage.mintId<DocumentId>();
  const taskDocumentId = await storage.mintId<DocumentId>();
  const createdAt = await storage.commit(
    [
      { type: "task", value: pendingTask(taskId) },
      {
        type: "document.create",
        record: sessionDocument(sessionId, "session"),
        content: { kind: "base", version: 1, value: {} },
      },
      {
        type: "document.create",
        record: {
          id: latestId,
          kind: "latest",
          scope: { kind: "conversation", conversationId: ROOT_CONVERSATION_ID },
          history: "latest",
          fork: "current",
        },
        content: { kind: "base", version: 1, value: {} },
      },
      {
        type: "document.create",
        record: { id: taskDocumentId, kind: "task", scope: { kind: "task", taskId } },
        content: { kind: "base", version: 1, value: {} },
      },
    ],
    context,
  );
  const retiredAt = await storage.commit(
    [
      { type: "document.retire", id: sessionId },
      { type: "document.retire", id: latestId },
      { type: "document.retire", id: taskDocumentId },
      { type: "task", value: terminalTask(taskId) },
    ],
    context,
  );
  return { directory, taskId, sessionId, latestId, taskDocumentId, createdAt, retiredAt };
}

describe("Pico JsonlStorage publication and recovery", () => {
  it("never reclaims rewindable document history, including after a base and retirement", async () => {
    const { directory, storage, id, createdAt, changedAt } = await rewindableHistory();
    await storage.commit([{ type: "document.retire", id }], context);

    expect(await readLines(join(directory, `doc-${id}.jsonl`))).toHaveLength(3);
    const reopened = await openStorage(directory);
    expect((await reopened.document(id, createdAt, context))?.value).toEqual({ count: 0 });
    expect((await reopened.document(id, changedAt, context))?.value).toEqual({ count: 1 });
    expect(await reopened.document(id, "current", context)).toBeUndefined();
    expect(await readLines(join(directory, `doc-${id}.jsonl`))).toHaveLength(3);
  });

  it("reclaims retired task-, session-, and latest-conversation document sidecars", async () => {
    const { directory, taskId, sessionId, latestId, taskDocumentId, createdAt, retiredAt } =
      await retiredSidecars();
    for await (const file of [
      `doc-${sessionId}.jsonl`,
      `doc-${latestId}.jsonl`,
      `doc-${taskDocumentId}.jsonl`,
      `task-${taskId}.jsonl`,
    ]) {
      expect(await fileExists(join(directory, file))).toBe(false);
    }

    const reopened = await openStorage(directory);
    expect(await reopened.task(taskId, context)).toEqual(terminalTask(taskId));
    expect(await reopened.document(sessionId, "current", context)).toBeUndefined();
    expect(await reopened.document(latestId, "current", context)).toBeUndefined();
    expect(await reopened.document(taskDocumentId, "current", context)).toBeUndefined();
    expect(
      await reopened.findDocument(
        { kind: "session", scope: { kind: "session" } },
        createdAt,
        context,
      ),
    ).toMatchObject({ id: sessionId, createdAt, retiredAt });
    expect(
      await reopened.findDocument(
        { kind: "session", scope: { kind: "session" } },
        retiredAt,
        context,
      ),
    ).toBeUndefined();
  });
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("truncates torn UTF-8 tails at exact byte offsets and reuses the unconfirmed sequence", async () => {
    const directory = await tempDirectory();
    const storage = await openStorage(directory);
    await createRoot(storage);
    const documentId = await storage.mintId<DocumentId>();
    await storage.commit(
      [
        {
          type: "document.create",
          record: sessionDocument(documentId),
          content: { kind: "base", version: 1, value: { text: "kept" } },
        },
      ],
      context,
    );
    const sidecarPath = join(directory, `doc-${documentId}.jsonl`);
    const mainPath = join(directory, "main.jsonl");
    const sidecarSize = (await stat(sidecarPath)).size;
    const mainSize = (await stat(mainPath)).size;
    const torn = new TextEncoder().encode('{"text":"€');
    await writeFile(sidecarPath, torn.subarray(0, torn.length - 1), { flag: "a" });
    await writeFile(mainPath, torn.subarray(0, torn.length - 1), { flag: "a" });

    const reopened = await openStorage(directory);
    expect((await stat(sidecarPath)).size).toBe(sidecarSize);
    expect((await stat(mainPath)).size).toBe(mainSize);
    expect(
      await reopened.commit(
        [
          {
            type: "document.change",
            id: documentId,
            content: { kind: "delta", version: 1, ops: [] },
          },
        ],
        context,
      ),
    ).toBe(3);
  });
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("removes complete unconfirmed sidecar tails without resurrecting terminal tasks", async () => {
    const directory = await tempDirectory();
    const storage = await openStorage(directory);
    await createRoot(storage);
    const taskId = await storage.mintId<TaskId<JsonValue>>();
    await storage.commit([{ type: "task", value: pendingTask(taskId) }], context);
    await storage.commit([{ type: "task", value: terminalTask(taskId) }], context);
    const sidecarPath = join(directory, `task-${taskId}.jsonl`);
    expect(await fileExists(sidecarPath)).toBe(false);
    await writeFile(
      sidecarPath,
      `${JSON.stringify({
        format: 1,
        type: "record",
        seq: 4,
        ordinal: 0,
        payload: { type: "task", value: pendingTask(taskId, "stale") },
      })}\n`,
      { flag: "a" },
    );

    const reopened = await openStorage(directory);
    expect(await fileExists(sidecarPath)).toBe(false);
    expect(await reopened.task(taskId, context)).toEqual(terminalTask(taskId));
    expect(await reopened.commit([], context)).toBe(4);
  });

  it("fails open when confirmed sidecar data is missing", async () => {
    const directory = await tempDirectory();
    const storage = await openStorage(directory);
    await createRoot(storage);
    const documentId = await storage.mintId<DocumentId>();
    await storage.commit(
      [
        {
          type: "document.create",
          record: sessionDocument(documentId),
          content: { kind: "base", version: 1, value: {} },
        },
      ],
      context,
    );
    await writeFile(join(directory, `doc-${documentId}.jsonl`), "");
    await expect(
      JsonlStorage.open(directory, new NodeExecutionEnv({ cwd: directory }), context),
    ).rejects.toThrow("Missing confirmed sidecar record");
  });
});

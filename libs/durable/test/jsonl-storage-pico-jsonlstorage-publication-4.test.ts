import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { JsonlStorage } from "../src/storage/jsonl/index.ts";
import type { DocumentId } from "../src/types.ts";
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

afterEach(async () => {
  for await (const storage of openStorages) await storage.close(context);
  openStorages.clear();
  for await (const directory of tempDirectories)
    await rm(directory, { recursive: true, force: true });
  tempDirectories.clear();
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("rejects a confirmed record after an unconfirmed sidecar record", async () => {
    const directory = await tempDirectory();
    const storage = await openStorage(directory);
    await createRoot(storage);
    const documentId = await storage.mintId<DocumentId>();
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
          content: { kind: "delta", version: 1, ops: [["s", ["count"], 1]] },
        },
      ],
      context,
    );
    const path = join(directory, `doc-${documentId}.jsonl`);
    const [first, second] = await readLines(path);
    const unconfirmed = JSON.stringify({
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
    await writeFile(path, `${first}\n${unconfirmed}\n${second}\n`);
    await expect(
      JsonlStorage.open(directory, new NodeExecutionEnv({ cwd: directory }), context),
    ).rejects.toThrow("Confirmed record follows an unconfirmed tail");
  });
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("rejects non-increasing main commit sequences", async () => {
    const directory = await tempDirectory();
    const storage = await openStorage(directory);
    await createRoot(storage);
    const path = join(directory, "main.jsonl");
    await writeFile(path, await readFile(path), { flag: "a" });

    await expect(
      JsonlStorage.open(directory, new NodeExecutionEnv({ cwd: directory }), context),
    ).rejects.toThrow("Commit sequence does not strictly increase");
  });

  it("rejects structurally invalid confirmed document content", async () => {
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
    const path = join(directory, `doc-${documentId}.jsonl`);
    const record = JSON.parse((await readFile(path, "utf8")).trim()) as {
      payload: { content: Record<string, unknown> };
    };
    delete record.payload.content["value"];
    await writeFile(path, `${JSON.stringify(record)}\n`);

    await expect(
      JsonlStorage.open(directory, new NodeExecutionEnv({ cwd: directory }), context),
    ).rejects.toThrow("Invalid document content");
  });
});

describe("Pico JsonlStorage publication and recovery", () => {
  it("rejects malformed complete main and sidecar lines", async () => {
    const mainDirectory = await tempDirectory();
    const mainStorage = await openStorage(mainDirectory);
    await createRoot(mainStorage);
    await writeFile(join(mainDirectory, "main.jsonl"), "{bad}\n", { flag: "a" });
    await expect(
      JsonlStorage.open(mainDirectory, new NodeExecutionEnv({ cwd: mainDirectory }), context),
    ).rejects.toThrow("Malformed complete main.jsonl");

    const sidecarDirectory = await tempDirectory();
    const sidecarStorage = await openStorage(sidecarDirectory);
    await createRoot(sidecarStorage);
    await writeFile(join(sidecarDirectory, "doc-99.jsonl"), "{bad}\n");
    await expect(
      JsonlStorage.open(sidecarDirectory, new NodeExecutionEnv({ cwd: sidecarDirectory }), context),
    ).rejects.toThrow("Malformed complete doc-99.jsonl");
  });
});

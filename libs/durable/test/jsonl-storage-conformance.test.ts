import type { Context } from "@msa/chord";
import { registerStorageConformance } from "@msa/durable/testing";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { idFromNumber } from "../src/ids.ts";
import { JsonlStorage } from "../src/storage/jsonl/index.ts";
import type { ConversationId, EntryId, Id, Seq, Storage, StorageWrite } from "../src/types.ts";
import {
  context,
  openStorage,
  openStorages,
  tempDirectories,
  tempDirectory,
} from "./jsonl-storage-support.ts";
import { removeDir } from "./temp-support.ts";

afterEach(async () => {
  for await (const storage of openStorages) await storage.close(context);
  openStorages.clear();
  for await (const directory of tempDirectories) await removeDir(directory);
  tempDirectories.clear();
});

async function createStorage(): Promise<JsonlStorage> {
  return openStorage(await tempDirectory());
}

class ReopeningStorage implements Storage {
  private current: JsonlStorage;
  private readonly directory: string;
  private closed = false;

  constructor(current: JsonlStorage, directory: string) {
    this.current = current;
    this.directory = directory;
  }

  async commit(writes: readonly StorageWrite[], commitContext: Context): Promise<Seq> {
    if (this.closed) return this.current.commit(writes, commitContext);
    try {
      return await this.current.commit(writes, commitContext);
    } finally {
      await this.current.close(context);
      this.current = await JsonlStorage.open(
        this.directory,
        new NodeExecutionEnv({ cwd: this.directory }),
        context,
      );
    }
  }

  mintId<I extends Id<string>>(): Promise<I> {
    return this.current.mintId<I>();
  }
  conversation: Storage["conversation"] = (id, readContext) =>
    this.current.conversation(id, readContext);
  scanConversations: Storage["scanConversations"] = (query, limit, cursor, readContext) =>
    this.current.scanConversations(query, limit, cursor, readContext);
  entry(id: EntryId, readContext: Context): ReturnType<Storage["entry"]>;
  entry(
    conversationId: ConversationId,
    id: EntryId,
    readContext: Context,
  ): ReturnType<Storage["entry"]>;
  entry(
    idOrConversationId: EntryId | ConversationId,
    idOrContext: EntryId | Context,
    readContext?: Context,
  ) {
    if (readContext === undefined) {
      return this.current.entry(idFromNumber<EntryId>(idOrConversationId), idOrContext as Context);
    }
    if (typeof idOrContext !== "number")
      throw new TypeError("Storage.entry() requires an entry ID");
    return this.current.entry(
      idFromNumber<ConversationId>(idOrConversationId),
      idFromNumber<EntryId>(idOrContext),
      readContext,
    );
  }
  findLatestHeadMarker: Storage["findLatestHeadMarker"] = (conversationId, at, readContext) =>
    this.current.findLatestHeadMarker(conversationId, at, readContext);
  scanEntries: Storage["scanEntries"] = (query, limit, cursor, readContext) =>
    this.current.scanEntries(query, limit, cursor, readContext);
  task: Storage["task"] = (id, readContext) => this.current.task(id, readContext);
  scanTasks: Storage["scanTasks"] = (query, limit, cursor, readContext) =>
    this.current.scanTasks(query, limit, cursor, readContext);
  submission: Storage["submission"] = (id, readContext) => this.current.submission(id, readContext);
  scanSubmissions: Storage["scanSubmissions"] = (query, limit, cursor, readContext) =>
    this.current.scanSubmissions(query, limit, cursor, readContext);
  submissionByRequest: Storage["submissionByRequest"] = (conversationId, requestId, readContext) =>
    this.current.submissionByRequest(conversationId, requestId, readContext);
  findDocument: Storage["findDocument"] = (address, at, readContext) =>
    this.current.findDocument(address, at, readContext);
  document: Storage["document"] = (id, at, readContext) =>
    this.current.document(id, at, readContext);
  scanDocuments: Storage["scanDocuments"] = (query, limit, cursor, readContext) =>
    this.current.scanDocuments(query, limit, cursor, readContext);

  async close(closeContext: Context): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.current.close(closeContext);
  }
}

registerStorageConformance({ describe, expect, it }, "JsonlStorage", async (use) =>
  use(await createStorage()),
);

registerStorageConformance({ describe, expect, it }, "JsonlStorage across reopen", async (use) => {
  const directory = await tempDirectory("msa-durable-jsonl-conformance-");
  const current = await JsonlStorage.open(
    directory,
    new NodeExecutionEnv({ cwd: directory }),
    context,
  );
  const storage = new ReopeningStorage(current, directory);
  try {
    await use(storage);
  } finally {
    await storage.close(context);
  }
});

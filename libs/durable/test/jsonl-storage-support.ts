import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { Context, JsonValue } from "@msa/chord";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";

import { err, FileError, type FileSystem, type Result } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { JsonlStorage } from "../src/storage/jsonl/index.ts";
import type { DocumentCreate, DocumentId, Storage, TaskId, TaskRecord } from "../src/types.ts";
import { ROOT_CONVERSATION_ID } from "../src/types.ts";

export const context = BACKGROUND_CONTEXT;

export type StoredTask = TaskRecord<JsonValue, JsonValue, JsonValue>;

export const tempDirectories = new Set<string>();

export const openStorages = new Set<JsonlStorage>();

export async function tempDirectory(prefix = "msa-durable-jsonl-"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  tempDirectories.add(directory);
  return directory;
}

export async function openStorage(
  directory: string,
  fs: FileSystem = new NodeExecutionEnv({ cwd: directory }),
  options: { readonly fsync?: boolean } = {},
): Promise<JsonlStorage> {
  const storage = await JsonlStorage.open(directory, fs, context, options);
  openStorages.add(storage);
  return storage;
}

export function pendingTask(id: TaskId<JsonValue>, phase = "ready"): StoredTask {
  return {
    id,
    conversationId: ROOT_CONVERSATION_ID,
    kind: "test.task",
    version: 1,
    input: null,
    state: { status: "pending", checkpoint: { phase } },
    background: false,
    abortRequested: false,
  };
}

export function terminalTask(id: TaskId<JsonValue>): StoredTask {
  return {
    id,
    conversationId: ROOT_CONVERSATION_ID,
    kind: "test.task",
    version: 1,
    input: null,
    state: { status: "terminal", outcome: { status: "completed", result: null } },
    background: false,
    abortRequested: false,
  };
}

export async function createRoot(storage: Storage): Promise<void> {
  await storage.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], context);
}

export function sessionDocument(id: DocumentId, kind = "test.document"): DocumentCreate {
  return { id, kind, scope: { kind: "session" } };
}

export type Failure = {
  readonly operation: "append" | "flush" | "write" | "rename" | "remove";
  readonly call: number;
  readonly mode: "before" | "after" | "short";
};

export class InstrumentedEnv extends NodeExecutionEnv {
  readonly operations: string[] = [];
  private failure: Failure | undefined;
  private appendCalls = 0;
  private flushCalls = 0;
  private writeCalls = 0;
  private renameCalls = 0;
  private removeCalls = 0;

  fail(failure: Failure): void {
    this.failure = failure;
    this.resetObservations();
  }

  clear(): void {
    this.failure = undefined;
    this.resetObservations();
  }

  private resetObservations(): void {
    this.appendCalls = 0;
    this.flushCalls = 0;
    this.writeCalls = 0;
    this.renameCalls = 0;
    this.removeCalls = 0;
    this.operations.length = 0;
  }

  override async appendFile(
    path: string,
    content: string | Uint8Array,
    appendContext: Context,
  ): Promise<Result<void, FileError>> {
    this.appendCalls++;
    this.operations.push(`append:${basename(path)}`);
    const failure = this.failure;
    if (failure?.operation !== "append" || failure.call !== this.appendCalls) {
      return super.appendFile(path, content, appendContext);
    }
    if (failure.mode === "before")
      return err(new FileError("unknown", "injected append failure", path));
    if (failure.mode === "short") {
      const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
      const partial = bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 2)));
      const written = await super.appendFile(path, partial, appendContext);
      if (!written.ok) return written;
      return err(new FileError("unknown", "injected short append", path));
    }
    const written = await super.appendFile(path, content, appendContext);
    if (!written.ok) return written;
    return err(new FileError("unknown", "injected post-append failure", path));
  }

  override async flushFile(path: string, flushContext: Context): Promise<Result<void, FileError>> {
    this.flushCalls++;
    this.operations.push(`flush:${basename(path)}`);
    const failure = this.failure;
    if (failure?.operation !== "flush" || failure.call !== this.flushCalls) {
      return super.flushFile(path, flushContext);
    }
    if (failure.mode === "after") {
      const flushed = await super.flushFile(path, flushContext);
      if (!flushed.ok) return flushed;
    }
    return err(new FileError("unknown", "injected flush failure", path));
  }

  override async writeFile(
    path: string,
    content: string | Uint8Array,
    writeContext: Context,
  ): Promise<Result<void, FileError>> {
    this.writeCalls++;
    this.operations.push(`write:${basename(path)}`);
    const failure = this.failure;
    if (failure?.operation !== "write" || failure.call !== this.writeCalls) {
      return super.writeFile(path, content, writeContext);
    }
    if (failure.mode === "before")
      return err(new FileError("unknown", "injected write failure", path));
    if (failure.mode === "short") {
      const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
      const partial = bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 2)));
      const written = await super.writeFile(path, partial, writeContext);
      if (!written.ok) return written;
      return err(new FileError("unknown", "injected short write", path));
    }
    const written = await super.writeFile(path, content, writeContext);
    if (!written.ok) return written;
    return err(new FileError("unknown", "injected post-write failure", path));
  }

  override async renameFile(
    sourcePath: string,
    destinationPath: string,
    renameContext: Context,
  ): Promise<Result<void, FileError>> {
    this.renameCalls++;
    this.operations.push(`rename:${basename(sourcePath)}->${basename(destinationPath)}`);
    const failure = this.failure;
    if (failure?.operation !== "rename" || failure.call !== this.renameCalls) {
      return super.renameFile(sourcePath, destinationPath, renameContext);
    }
    if (failure.mode === "after") {
      const renamed = await super.renameFile(sourcePath, destinationPath, renameContext);
      if (!renamed.ok) return renamed;
    }
    return err(new FileError("unknown", "injected rename failure", sourcePath));
  }

  override async remove(
    path: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
    removeContext: Context,
  ): Promise<Result<void, FileError>> {
    this.removeCalls++;
    this.operations.push(`remove:${basename(path)}`);
    const failure = this.failure;
    if (failure?.operation !== "remove" || failure.call !== this.removeCalls) {
      return super.remove(path, options, removeContext);
    }
    if (failure.mode === "after") {
      const removed = await super.remove(path, options, removeContext);
      if (!removed.ok) return removed;
    }
    return err(new FileError("unknown", "injected remove failure", path));
  }
}

export async function readLines(path: string): Promise<string[]> {
  const text = await readFile(path, "utf8");
  return text === "" ? [] : text.trimEnd().split("\n");
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

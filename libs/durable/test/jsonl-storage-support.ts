import type { Context, JsonValue } from "@msa/chord";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { err, FileError, type FileSystem, type Result } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { JsonlStorage } from "../src/storage/jsonl/index.ts";
import type { DocumentCreate, DocumentId, Storage, TaskId, TaskRecord } from "../src/types.ts";
import { ROOT_CONVERSATION_ID } from "../src/types.ts";
import { awaited } from "./effect-support.ts";
import { basenameOf, makeTempDir, pathExists, readText } from "./platform-support.ts";

export const context = BACKGROUND_CONTEXT;

export type StoredTask = TaskRecord<JsonValue, JsonValue, JsonValue>;

export const tempDirectories = new Set<string>();

export const openStorages = new Set<JsonlStorage>();

export const tempDirectory = Effect.fn("tempDirectory")(function* (prefix = "msa-durable-jsonl-") {
  const directory = yield* makeTempDir(prefix);
  tempDirectories.add(directory);
  return directory;
});

export const openStorage = Effect.fn("openStorage")(function* (
  directory: string,
  fs: FileSystem = new NodeExecutionEnv({ cwd: directory }),
  options: { readonly fsync?: boolean } = {},
) {
  const storage = yield* awaited(JsonlStorage.open(directory, fs, context, options));
  openStorages.add(storage);
  return storage;
});

function pendingTaskImpl(id: TaskId<JsonValue>, phase = "ready"): StoredTask {
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

export const pendingTask: {
  (phase?: string): (id: TaskId<JsonValue>) => ReturnType<typeof pendingTaskImpl>;
  (id: TaskId<JsonValue>, phase?: string): ReturnType<typeof pendingTaskImpl>;
} = dual((args) => typeof args[0] === "number", pendingTaskImpl);

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

export const createRoot = Effect.fn("createRoot")(function* (storage: Storage) {
  yield* awaited(
    storage.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], context),
  );
});

function sessionDocumentImpl(id: DocumentId, kind = "test.document"): DocumentCreate {
  return { id, kind, scope: { kind: "session" } };
}

export const sessionDocument: {
  (kind?: string): (id: DocumentId) => ReturnType<typeof sessionDocumentImpl>;
  (id: DocumentId, kind?: string): ReturnType<typeof sessionDocumentImpl>;
} = dual((args) => typeof args[0] === "number", sessionDocumentImpl);

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

  override appendFile(
    path: string,
    content: string | Uint8Array,
    appendContext: Context,
  ): Promise<Result<void, FileError>> {
    const superAppendFile = super.appendFile.bind(this);
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        this.appendCalls++;
        this.operations.push(`append:${basenameOf(path)}`);
        const failure = this.failure;
        if (failure?.operation !== "append" || failure.call !== this.appendCalls) {
          return yield* awaited(superAppendFile(path, content, appendContext));
        }
        if (failure.mode === "before")
          return err(new FileError("unknown", "injected append failure", path));
        if (failure.mode === "short") {
          const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
          const partial = bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 2)));
          const written = yield* awaited(superAppendFile(path, partial, appendContext));
          if (!written.ok) return written;
          return err(new FileError("unknown", "injected short append", path));
        }
        const written = yield* awaited(superAppendFile(path, content, appendContext));
        if (!written.ok) return written;
        return err(new FileError("unknown", "injected post-append failure", path));
      }),
    );
  }

  override flushFile(path: string, flushContext: Context): Promise<Result<void, FileError>> {
    const superFlushFile = super.flushFile.bind(this);
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        this.flushCalls++;
        this.operations.push(`flush:${basenameOf(path)}`);
        const failure = this.failure;
        if (failure?.operation !== "flush" || failure.call !== this.flushCalls) {
          return yield* awaited(superFlushFile(path, flushContext));
        }
        if (failure.mode === "after") {
          const flushed = yield* awaited(superFlushFile(path, flushContext));
          if (!flushed.ok) return flushed;
        }
        return err(new FileError("unknown", "injected flush failure", path));
      }),
    );
  }

  override writeFile(
    path: string,
    content: string | Uint8Array,
    writeContext: Context,
  ): Promise<Result<void, FileError>> {
    const superWriteFile = super.writeFile.bind(this);
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        this.writeCalls++;
        this.operations.push(`write:${basenameOf(path)}`);
        const failure = this.failure;
        if (failure?.operation !== "write" || failure.call !== this.writeCalls) {
          return yield* awaited(superWriteFile(path, content, writeContext));
        }
        if (failure.mode === "before")
          return err(new FileError("unknown", "injected write failure", path));
        if (failure.mode === "short") {
          const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
          const partial = bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 2)));
          const written = yield* awaited(superWriteFile(path, partial, writeContext));
          if (!written.ok) return written;
          return err(new FileError("unknown", "injected short write", path));
        }
        const written = yield* awaited(superWriteFile(path, content, writeContext));
        if (!written.ok) return written;
        return err(new FileError("unknown", "injected post-write failure", path));
      }),
    );
  }

  override renameFile(
    sourcePath: string,
    destinationPath: string,
    renameContext: Context,
  ): Promise<Result<void, FileError>> {
    const superRenameFile = super.renameFile.bind(this);
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        this.renameCalls++;
        this.operations.push(`rename:${basenameOf(sourcePath)}->${basenameOf(destinationPath)}`);
        const failure = this.failure;
        if (failure?.operation !== "rename" || failure.call !== this.renameCalls) {
          return yield* awaited(superRenameFile(sourcePath, destinationPath, renameContext));
        }
        if (failure.mode === "after") {
          const renamed = yield* awaited(
            superRenameFile(sourcePath, destinationPath, renameContext),
          );
          if (!renamed.ok) return renamed;
        }
        return err(new FileError("unknown", "injected rename failure", sourcePath));
      }),
    );
  }

  override remove(
    path: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
    removeContext: Context,
  ): Promise<Result<void, FileError>> {
    const superRemove = super.remove.bind(this);
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        this.removeCalls++;
        this.operations.push(`remove:${basenameOf(path)}`);
        const failure = this.failure;
        if (failure?.operation !== "remove" || failure.call !== this.removeCalls) {
          return yield* awaited(superRemove(path, options, removeContext));
        }
        if (failure.mode === "after") {
          const removed = yield* awaited(superRemove(path, options, removeContext));
          if (!removed.ok) return removed;
        }
        return err(new FileError("unknown", "injected remove failure", path));
      }),
    );
  }
}

export const readLines = Effect.fn("readLines")(function* (path: string) {
  const text = yield* readText(path);
  return text === "" ? [] : text.trimEnd().split("\n");
});

export const fileExists = pathExists;

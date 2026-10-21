import contextModule from "@msa/chord/context";
import { Effect } from "effect";
import { dual } from "effect/Function";

import env from "../src/env/index.ts";
import node from "../src/env/node.ts";
import jsonl from "../src/storage/jsonl/index.ts";
import types from "../src/types.ts";
import type typesModule from "../src/types.types.ts";
import type jsonlStorageSupportTypes from "./jsonl-storage-support.types.ts";
import testSupport from "./support.ts";

const { BACKGROUND_CONTEXT } = contextModule;

const { NodeExecutionEnv } = node;
const { JsonlStorage } = jsonl;
const { ROOT_CONVERSATION_ID } = types;
const { FileError, err } = env;

const { awaited } = testSupport;
const { basenameOf, makeTempDir, pathExists, readText } = testSupport;

const context = BACKGROUND_CONTEXT;

const tempDirectories = new Set<string>();

const openStorages = new Set<jsonlStorageSupportTypes.JsonlStorage>();

const tempDirectory = Effect.fn("tempDirectory")(function* (prefix = "msa-durable-jsonl-") {
  const directory = yield* makeTempDir(prefix);
  tempDirectories.add(directory);
  return directory;
});

const openStorage = Effect.fn("openStorage")(function* (
  directory: string,
  fs: jsonlStorageSupportTypes.FileSystem = new NodeExecutionEnv({ cwd: directory }),
  options: { readonly fsync?: boolean } = {},
) {
  const storage = yield* awaited(JsonlStorage.open(directory, fs, context, options));
  openStorages.add(storage);
  return storage;
});

function pendingTaskImpl(
  id: typesModule.TaskId<jsonlStorageSupportTypes.JsonValue>,
  phase = "ready",
): jsonlStorageSupportTypes.StoredTask {
  return {
    abortRequested: false,
    background: false,
    conversationId: ROOT_CONVERSATION_ID,
    id,
    input: null,
    kind: "test.task",
    state: { checkpoint: { phase }, status: "pending" },
    version: 1,
  };
}

const pendingTask: {
  (
    phase?: string,
  ): (
    id: typesModule.TaskId<jsonlStorageSupportTypes.JsonValue>,
  ) => ReturnType<typeof pendingTaskImpl>;
  (
    id: typesModule.TaskId<jsonlStorageSupportTypes.JsonValue>,
    phase?: string,
  ): ReturnType<typeof pendingTaskImpl>;
} = dual((args) => typeof args[0] === "number", pendingTaskImpl);

function terminalTask(
  id: typesModule.TaskId<jsonlStorageSupportTypes.JsonValue>,
): jsonlStorageSupportTypes.StoredTask {
  return {
    abortRequested: false,
    background: false,
    conversationId: ROOT_CONVERSATION_ID,
    id,
    input: null,
    kind: "test.task",
    state: { outcome: { result: null, status: "completed" }, status: "terminal" },
    version: 1,
  };
}

const createRoot = Effect.fn("createRoot")(function* (storage: typesModule.Storage) {
  yield* awaited(
    storage.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], context),
  );
});

function sessionDocumentImpl(
  id: typesModule.DocumentId,
  kind = "test.document",
): typesModule.DocumentCreate {
  return { id, kind, scope: { kind: "session" } };
}

const sessionDocument: {
  (kind?: string): (id: typesModule.DocumentId) => ReturnType<typeof sessionDocumentImpl>;
  (id: typesModule.DocumentId, kind?: string): ReturnType<typeof sessionDocumentImpl>;
} = dual((args) => typeof args[0] === "number", sessionDocumentImpl);

class InstrumentedEnv extends node.NodeExecutionEnv {
  readonly operations: string[] = [];
  private failure: jsonlStorageSupportTypes.Failure | undefined;
  private appendCalls = 0;
  private flushCalls = 0;
  private writeCalls = 0;
  private renameCalls = 0;
  private removeCalls = 0;

  fail(failure: jsonlStorageSupportTypes.Failure): void {
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
    appendContext: jsonlStorageSupportTypes.Context,
  ): Promise<jsonlStorageSupportTypes.Result<void, jsonlStorageSupportTypes.FileError>> {
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

  override flushFile(
    path: string,
    flushContext: jsonlStorageSupportTypes.Context,
  ): Promise<jsonlStorageSupportTypes.Result<void, jsonlStorageSupportTypes.FileError>> {
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
    writeContext: jsonlStorageSupportTypes.Context,
  ): Promise<jsonlStorageSupportTypes.Result<void, jsonlStorageSupportTypes.FileError>> {
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
    renameContext: jsonlStorageSupportTypes.Context,
  ): Promise<jsonlStorageSupportTypes.Result<void, jsonlStorageSupportTypes.FileError>> {
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
    removeContext: jsonlStorageSupportTypes.Context,
  ): Promise<jsonlStorageSupportTypes.Result<void, jsonlStorageSupportTypes.FileError>> {
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

const readLines = Effect.fn("readLines")(function* (path: string) {
  const text = yield* readText(path);
  return text === "" ? [] : text.trimEnd().split("\n");
});

const fileExists = pathExists;

const jsonlStorageSupport = {
  InstrumentedEnv,
  context,
  createRoot,
  fileExists,
  openStorage,
  openStorages,
  pendingTask,
  readLines,
  sessionDocument,
  tempDirectories,
  tempDirectory,
  terminalTask,
};

export default jsonlStorageSupport;

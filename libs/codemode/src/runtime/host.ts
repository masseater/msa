import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, FileSystem, ManagedRuntime } from "effect";

import type { CodemodeSandboxOptions, CodemodeWasmModule } from "../types.ts";
import { RuntimeError } from "./bridge.ts";
import { loadWasm } from "./inline.ts";
import { errorMessage } from "./prelude-source.ts";
import type { VmChannel, VmEvents, VmLauncher, WorkerData } from "./protocol.ts";
import { CodemodeSandboxBase } from "./sandbox-base.ts";
const runtime = ManagedRuntime.make(
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:fs has no stable Effect replacement
  NodeFileSystem.layer,
);

const readFileBytes = (path: string): Promise<Uint8Array> =>
  runtime.runPromise(
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:fs has no stable Effect replacement
    FileSystem.FileSystem.use((fs) => fs.readFile(path)).pipe(
      Effect.mapError((error) => error.cause ?? error),
    ),
  );

interface WebAssemblyGlobal {
  compile(bytes: Uint8Array): Promise<CodemodeWasmModule>;
}

const modules = new Map<string, Promise<CodemodeWasmModule>>();

export function loadQuickJSWasm(path?: string): Promise<CodemodeWasmModule> {
  const resolved = path ?? createRequire(import.meta.url).resolve("quickjs-wasi/quickjs.wasm");
  let module = modules.get(resolved);
  if (module === undefined) {
    const { WebAssembly } = globalThis as unknown as { WebAssembly: WebAssemblyGlobal };
    module = readFileBytes(resolved)
      .then((bytes) => WebAssembly.compile(bytes))
      .catch((error: unknown) => {
        modules.delete(resolved);
        throw error;
      });
    modules.set(resolved, module);
  }
  return module;
}

function defaultWorkerUrl(): URL {
  return new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js", import.meta.url);
}

const isWatchMessage = (message: unknown): boolean =>
  typeof message === "object" &&
  message !== null &&
  ("watch:import" in message || "watch:require" in message);

function forwardEvents(worker: Worker, events: VmEvents): void {
  worker.on("message", (message: unknown) => {
    if (!isWatchMessage(message)) events.message(message);
  });
  worker.on("error", (error: unknown) => {
    events.failure({
      kind: "sandbox",
      name: error instanceof Error ? error.name : undefined,
      message: errorMessage(error),
    });
  });
  worker.on("exit", (code) => {
    events.failure({
      kind: "sandbox",
      message: `Worker exited with code ${code} before the script settled`,
    });
  });
}

const spawnWorker = (options: CodemodeSandboxOptions, workerData: WorkerData) =>
  Effect.try({
    try: () => new Worker(options.workerUrl ?? defaultWorkerUrl(), { workerData }),
    catch: (cause) =>
      new RuntimeError({
        reason: "launch",
        message: `Failed to start worker: ${errorMessage(cause)}`,
        cause,
      }),
  });

const channelOf = (worker: Worker, interrupt: SharedArrayBuffer): VmChannel => ({
  post: (message) => worker.postMessage(message),
  stop: Effect.sync(() => {
    Atomics.store(new Int32Array(interrupt), 0, 1);
    void worker.terminate().catch(() => undefined);
    worker.unref();
  }),
});

const exited = (worker: Worker): Promise<void> =>
  Effect.runPromise(
    Effect.callback<void>((resume) => {
      worker.once("exit", () => resume(Effect.void));
    }),
  );

const reportStarted = (options: CodemodeSandboxOptions, channel: VmChannel, worker: Worker) =>
  Effect.try({
    try: () => options.onWorkerStarted?.(exited(worker)),
    catch: (cause) => new RuntimeError({ reason: "launch", message: errorMessage(cause), cause }),
  }).pipe(Effect.tapError(() => channel.stop));

function workerLauncher(options: CodemodeSandboxOptions): VmLauncher {
  return (data, events) =>
    Effect.gen(function* () {
      const module = yield* loadWasm(() => options.wasm ?? loadQuickJSWasm());
      const interrupt = new SharedArrayBuffer(4);
      const releaseWorker = options.acquireWorker?.();
      const worker = yield* spawnWorker(options, { ...data, wasm: module, interrupt }).pipe(
        Effect.tapError(() => Effect.sync(() => releaseWorker?.())),
      );
      if (releaseWorker !== undefined) worker.once("exit", releaseWorker);
      forwardEvents(worker, events);
      const channel = channelOf(worker, interrupt);
      yield* reportStarted(options, channel, worker);
      return channel;
    });
}

export class CodemodeSandbox extends CodemodeSandboxBase {
  constructor(options: CodemodeSandboxOptions = {}) {
    super(options, workerLauncher(options));
  }
}

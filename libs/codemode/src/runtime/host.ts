import { Worker } from "node:worker_threads";

import * as Effect from "effect/Effect";

import type { CodemodeSandboxOptions } from "../types.ts";
import { loadQuickJSWasm } from "../wasm.ts";
import { errorMessage } from "./bridge.ts";
import { loadWasm } from "./inline.ts";
import {
  LaunchError,
  type VmChannel,
  type VmEvents,
  type VmLauncher,
  type WorkerData,
} from "./launcher.ts";
import { CodemodeSandboxBase } from "./sandbox-base.ts";

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
      new LaunchError({ message: `Failed to start worker: ${errorMessage(cause)}`, cause }),
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
    catch: (cause) => new LaunchError({ message: errorMessage(cause), cause }),
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

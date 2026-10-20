import { Worker } from "node:worker_threads";

import { Effect } from "effect";

import type typesModule from "../types.ts";
import bridge from "./bridge.ts";
import hostModule from "./host.ts";
import inline from "./inline.ts";
import preludeSource from "./prelude-source.ts";
import type protocolTypes from "./protocol.ts";
import sandboxBase from "./sandbox-base.ts";

const { errorMessage } = preludeSource;
const { RuntimeError } = bridge;
const { loadWasm } = inline;
const { CodemodeSandboxBase } = sandboxBase;

function defaultWorkerUrl(): URL {
  return new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js", import.meta.url);
}

const isWatchMessage = (message: unknown): boolean =>
  typeof message === "object" &&
  message !== null &&
  ("watch:import" in message || "watch:require" in message);

function forwardEvents(worker: Worker, events: protocolTypes.VmEvents): void {
  worker.on("message", (message: unknown) => {
    if (!isWatchMessage(message)) events.message(message);
  });
  worker.on("error", (error: unknown) => {
    events.failure({
      kind: "sandbox",
      message: errorMessage(error),
      name: error instanceof Error ? error.name : undefined,
    });
  });
  worker.on("exit", (code) => {
    events.failure({
      kind: "sandbox",
      message: `Worker exited with code ${code} before the script settled`,
    });
  });
}

const spawnWorker = (
  options: typesModule.CodemodeSandboxOptions,
  workerData: protocolTypes.WorkerData,
) =>
  Effect.try({
    catch: (cause) =>
      new RuntimeError({
        cause,
        message: `Failed to start worker: ${errorMessage(cause)}`,
        reason: "launch",
      }),
    try: () => new Worker(options.workerUrl ?? defaultWorkerUrl(), { workerData }),
  });

const channelOf = (worker: Worker, interrupt: SharedArrayBuffer): protocolTypes.VmChannel => ({
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

const reportStarted = (
  options: typesModule.CodemodeSandboxOptions,
  channel: protocolTypes.VmChannel,
  worker: Worker,
) =>
  Effect.try({
    catch: (cause) => new RuntimeError({ cause, message: errorMessage(cause), reason: "launch" }),
    try: () => options.onWorkerStarted?.(exited(worker)),
  }).pipe(Effect.tapError(() => channel.stop));

function workerLauncher(options: typesModule.CodemodeSandboxOptions): protocolTypes.VmLauncher {
  return (data, events) =>
    Effect.gen(function* () {
      const module = yield* loadWasm(() => options.wasm ?? hostModule.loadQuickJSWasm());
      const interrupt = new SharedArrayBuffer(4);
      const releaseWorker = options.acquireWorker?.();
      const worker = yield* spawnWorker(options, { ...data, interrupt, wasm: module }).pipe(
        Effect.tapError(() => Effect.sync(() => releaseWorker?.())),
      );
      if (releaseWorker !== undefined) worker.once("exit", releaseWorker);
      forwardEvents(worker, events);
      const channel = channelOf(worker, interrupt);
      yield* reportStarted(options, channel, worker);
      return channel;
    });
}

export default class CodemodeSandbox extends CodemodeSandboxBase {
  constructor(options: typesModule.CodemodeSandboxOptions = {}) {
    super(options, workerLauncher(options));
  }
}

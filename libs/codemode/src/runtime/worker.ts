import { parentPort, workerData } from "node:worker_threads";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import { LaunchError } from "./errors/launch-error.ts";
import { isHostToWorkerMessage, type WorkerData, type WorkerToHostMessage } from "./protocol.ts";
import { crashMessage } from "./vm-wasi.ts";
import { startVm } from "./vm.ts";

function post(message: WorkerToHostMessage): void {
  parentPort?.postMessage(message);
}

const original = (error: unknown): unknown => (error instanceof LaunchError ? error.cause : error);

const main = (data: WorkerData) =>
  Effect.suspend(() => {
    const interrupt = new Int32Array(data.interrupt);
    return startVm({
      data,
      wasm: data.wasm,
      post,
      shouldInterrupt: () => Atomics.load(interrupt, 0) !== 0,
    });
  }).pipe(
    Effect.map((session) =>
      parentPort?.on("message", (message: unknown) => {
        if (isHostToWorkerMessage(message)) session.deliver(message);
      }),
    ),
    Effect.catchCause((cause) =>
      Effect.sync(() => post(cause.pipe(Cause.squash, original, crashMessage))),
    ),
  );

if (parentPort !== null) Effect.runFork(main(workerData as WorkerData));

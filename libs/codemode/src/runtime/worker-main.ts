import { parentPort, workerData } from "node:worker_threads";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import bridge from "./bridge.ts";
import inline from "./inline.ts";
import type protocolTypes from "./protocol.ts";
import vmSession from "./vm-session.ts";

const { RuntimeError } = bridge;
const { startVm } = inline;
const { crashMessage, isHostToWorkerMessage } = vmSession;

function post(message: protocolTypes.WorkerToHostMessage): void {
  parentPort?.postMessage(message);
}

const original = (error: unknown): unknown =>
  error instanceof RuntimeError && error.reason === "launch" ? error.cause : error;

const main = (data: protocolTypes.WorkerData) =>
  Effect.suspend(() => {
    const interrupt = new Int32Array(data.interrupt);
    return startVm({
      data,
      post,
      shouldInterrupt: () => Atomics.load(interrupt, 0) !== 0,
      wasm: data.wasm,
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

function startCodemodeWorker(): void {
  if (parentPort !== null) Effect.runFork(main(workerData as protocolTypes.WorkerData));
}

const workerMain = {
  startCodemodeWorker,
};

export default workerMain;

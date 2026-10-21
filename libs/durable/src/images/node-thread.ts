import { Worker } from "node:worker_threads";

import type imageTypes from "../tools/image.types.ts";
import unrefTimer from "../unref-timer.ts";
import type unrefTimerTypes from "../unref-timer.types.ts";
import type nodeThreadTypes from "./node-thread.types.ts";
import type nodeWorkerTypes from "./node-worker.types.ts";
import WorkerUnavailable from "./worker-unavailable.ts";

const { startUnrefTimer } = unrefTimer;

const unavailable = (cause: unknown): WorkerUnavailable =>
  new WorkerUnavailable({ cause, message: "The Photon image worker cannot start" });

const startWorker = (wasm: Uint8Array): Worker => {
  const file = import.meta.url.endsWith(".ts") ? "./node-worker.ts" : "./node-worker.js";
  try {
    return new Worker(new URL(file, import.meta.url), { workerData: wasm });
  } catch (error) {
    throw unavailable(error);
  }
};

type Requests = {
  readonly size: () => number;
  readonly open: () => {
    readonly id: number;
    readonly promise: Promise<imageTypes.PreparedImage | undefined>;
  };
  readonly answer: (reply: nodeWorkerTypes.PrepareReply) => boolean;
  readonly failAll: (error: unknown) => void;
};

const requests = (): Requests => {
  const pending = new Map<number, PromiseWithResolvers<imageTypes.PreparedImage | undefined>>();
  let nextId = 0;
  return {
    answer: (reply) => {
      const request = pending.get(reply.id);
      if (request === undefined) return false;
      pending.delete(reply.id);
      if ("error" in reply) request.reject(new Error(reply.error));
      else request.resolve(reply.result);
      return true;
    },
    failAll: (error) => {
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    },
    open: () => {
      const id = nextId++;
      const request = Promise.withResolvers<imageTypes.PreparedImage | undefined>();
      pending.set(id, request);
      return { id, promise: request.promise };
    },
    size: () => pending.size,
  };
};

const startPhotonThread = ({
  wasm,
  idleMs,
  onExit,
}: nodeThreadTypes.PhotonThreadOptions): nodeThreadTypes.PhotonThread => {
  const worker = startWorker(wasm);
  const book = requests();
  let idle: unrefTimerTypes.UnrefTimer | undefined;
  let started = false;
  const exit = (): void => {
    idle?.cancel();
    idle = undefined;
    onExit();
  };
  const fail = (error: unknown): void => {
    book.failAll(started ? error : unavailable(error));
    exit();
  };
  worker.unref();
  worker.on("message", (reply: nodeWorkerTypes.PrepareReply) => {
    started = true;
    if (!book.answer(reply) || book.size() > 0) return;
    worker.unref();
    idle = startUnrefTimer(() => {
      exit();
      void worker.terminate();
    }, idleMs);
  });
  worker.on("error", fail);
  worker.on("exit", (code) => fail(new Error(`The Photon image worker exited with code ${code}`)));
  return {
    prepare(bytes, mimeType, limits) {
      const { id, promise } = book.open();
      idle?.cancel();
      idle = undefined;
      worker.ref();
      const copy = bytes.slice();
      worker.postMessage(
        { bytes: copy, id, limits, mimeType } satisfies nodeWorkerTypes.PrepareRequest,
        [copy.buffer],
      );
      return promise;
    },
  };
};

const nodeThread = {
  WorkerUnavailable,
  startPhotonThread,
};

export default nodeThread;

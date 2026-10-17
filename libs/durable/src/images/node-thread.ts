import { Worker } from "node:worker_threads";

import { Data } from "effect";

import type { ImageLimits, PreparedImage } from "../tools/image-processor.ts";
import type { PrepareReply, PrepareRequest } from "./node-worker.ts";

export class WorkerUnavailable extends Data.TaggedError("WorkerUnavailable")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export type PhotonThread = {
  prepare(
    bytes: Uint8Array,
    mimeType: string,
    limits: ImageLimits,
  ): Promise<PreparedImage | undefined>;
};

const unavailable = (cause: unknown): WorkerUnavailable =>
  new WorkerUnavailable({ message: "The Photon image worker cannot start", cause });

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
    readonly promise: Promise<PreparedImage | undefined>;
  };
  readonly answer: (reply: PrepareReply) => boolean;
  readonly failAll: (error: unknown) => void;
};

const requests = (): Requests => {
  const pending = new Map<number, PromiseWithResolvers<PreparedImage | undefined>>();
  let nextId = 0;
  return {
    size: () => pending.size,
    open: () => {
      const id = nextId++;
      const request = Promise.withResolvers<PreparedImage | undefined>();
      pending.set(id, request);
      return { id, promise: request.promise };
    },
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
  };
};

export type PhotonThreadOptions = {
  readonly wasm: Uint8Array;
  readonly idleMs: number;
  readonly onExit: () => void;
};

export const startPhotonThread = ({ wasm, idleMs, onExit }: PhotonThreadOptions): PhotonThread => {
  const worker = startWorker(wasm);
  const book = requests();
  let idle: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  const exit = (): void => {
    if (idle !== undefined) clearTimeout(idle);
    idle = undefined;
    onExit();
  };
  const fail = (error: unknown): void => {
    book.failAll(started ? error : unavailable(error));
    exit();
  };
  worker.unref();
  worker.on("message", (reply: PrepareReply) => {
    started = true;
    if (!book.answer(reply) || book.size() > 0) return;
    worker.unref();
    idle = setTimeout(() => {
      exit();
      void worker.terminate();
    }, idleMs);
    idle.unref();
  });
  worker.on("error", fail);
  worker.on("exit", (code) => fail(new Error(`The Photon image worker exited with code ${code}`)));
  return {
    prepare(bytes, mimeType, limits) {
      const { id, promise } = book.open();
      if (idle !== undefined) clearTimeout(idle);
      idle = undefined;
      worker.ref();
      const copy = bytes.slice();
      worker.postMessage({ id, bytes: copy, mimeType, limits } satisfies PrepareRequest, [
        copy.buffer,
      ]);
      return promise;
    },
  };
};

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

import { promiseTry } from "../promise-try.ts";
import type { ImageLimits, ImageProcessor, PreparedImage } from "../tools/image-processor.ts";
import { createPhotonImages } from "./index.ts";
import type { PrepareReply, PrepareRequest } from "./node-worker.ts";

export type NodePhotonImagesOptions = {
  readonly worker?: boolean;
  readonly idleMs?: number;
};

export function createNodePhotonImages(
  options: NodePhotonImagesOptions = {},
): Promise<ImageProcessor> {
  return promiseTry(() => (options.worker === false ? inProcess() : threaded(options)));
}

function threaded(options: NodePhotonImagesOptions): ImageProcessor {
  const idleMs = options.idleMs ?? 30_000;
  let thread: PhotonThread | undefined;
  let fallback: Promise<ImageProcessor> | undefined;
  return {
    async prepare(bytes, mimeType, limits) {
      if (fallback !== undefined) return (await fallback).prepare(bytes, mimeType, limits);
      try {
        thread ??= new PhotonThread(idleMs, () => {
          thread = undefined;
        });
        return await thread.prepare(bytes, mimeType, limits);
      } catch (error) {
        if (!(error instanceof WorkerUnavailable)) throw error;
        fallback = inProcess();
        return (await fallback).prepare(bytes, mimeType, limits);
      }
    },
  };
}

async function inProcess(): Promise<ImageProcessor> {
  const path = createRequire(import.meta.url).resolve("@silvia-odwyer/photon/photon_rs_bg.wasm");
  return createPhotonImages(await readFile(path));
}

class WorkerUnavailable extends Error {}

class PhotonThread {
  readonly #worker: Worker;
  readonly #pending = new Map<number, PromiseWithResolvers<PreparedImage | undefined>>();
  readonly #idleMs: number;
  readonly #onExit: () => void;
  #nextId = 0;
  #idle: ReturnType<typeof setTimeout> | undefined;
  #started = false;

  constructor(idleMs: number, onExit: () => void) {
    this.#idleMs = idleMs;
    this.#onExit = onExit;
    const file = import.meta.url.endsWith(".ts") ? "./node-worker.ts" : "./node-worker.js";
    try {
      this.#worker = new Worker(new URL(file, import.meta.url));
    } catch (error) {
      throw new WorkerUnavailable("The Photon image worker cannot start", { cause: error });
    }
    this.#worker.unref();
    this.#worker.on("message", (reply: PrepareReply) => {
      this.#started = true;
      const request = this.#pending.get(reply.id);
      if (request === undefined) return;
      this.#pending.delete(reply.id);
      if ("error" in reply) request.reject(new Error(reply.error));
      else request.resolve(reply.result);
      this.#settled();
    });
    const fail = (error: unknown): void => {
      const failure = this.#started
        ? error
        : new WorkerUnavailable("The Photon image worker cannot start", { cause: error });
      for (const request of this.#pending.values()) request.reject(failure);
      this.#pending.clear();
      this.#exit();
    };
    this.#worker.on("error", fail);
    this.#worker.on("exit", (code) =>
      fail(new Error(`The Photon image worker exited with code ${code}`)),
    );
  }

  prepare(
    bytes: Uint8Array,
    mimeType: string,
    limits: ImageLimits,
  ): Promise<PreparedImage | undefined> {
    const id = this.#nextId++;
    const request = Promise.withResolvers<PreparedImage | undefined>();
    this.#pending.set(id, request);
    if (this.#idle !== undefined) clearTimeout(this.#idle);
    this.#idle = undefined;
    this.#worker.ref();
    const copy = bytes.slice();
    this.#worker.postMessage({ id, bytes: copy, mimeType, limits } satisfies PrepareRequest, [
      copy.buffer,
    ]);
    return request.promise;
  }

  #settled(): void {
    if (this.#pending.size > 0) return;
    this.#worker.unref();
    this.#idle = setTimeout(() => {
      this.#exit();
      void this.#worker.terminate();
    }, this.#idleMs);
    this.#idle.unref();
  }

  #exit(): void {
    if (this.#idle !== undefined) clearTimeout(this.#idle);
    this.#idle = undefined;
    this.#onExit();
  }
}

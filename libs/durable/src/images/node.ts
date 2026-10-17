import { createRequire } from "node:module";

import { Effect, FileSystem } from "effect";

import { nodeRuntime } from "../node-runtime.ts";
import type { ImageLimits, ImageProcessor } from "../tools/image-processor.ts";
import { createPhotonImages } from "./index.ts";
import { type PhotonThread, startPhotonThread, WorkerUnavailable } from "./node-thread.ts";

export type NodePhotonImagesOptions = {
  readonly worker?: boolean;
  readonly idleMs?: number;
};

const readPhotonWasm = (): Promise<Uint8Array> =>
  nodeRuntime.runPromise(
    FileSystem.FileSystem.use((fs) =>
      fs.readFile(
        createRequire(import.meta.url).resolve("@silvia-odwyer/photon/photon_rs_bg.wasm"),
      ),
    ).pipe(Effect.mapError((error) => error.cause ?? error)),
  );

const inProcess = (): Promise<ImageProcessor> =>
  readPhotonWasm().then((wasm) => createPhotonImages(wasm));

const prepareWith = (
  processor: Promise<ImageProcessor>,
  bytes: Uint8Array,
  mimeType: string,
  limits: ImageLimits,
) =>
  Effect.flatMap(
    Effect.promise(() => processor),
    (images) => Effect.promise(() => images.prepare(bytes, mimeType, limits)),
  );

function threaded(options: NodePhotonImagesOptions): ImageProcessor {
  const idleMs = options.idleMs ?? 30_000;
  let thread: Promise<PhotonThread> | undefined;
  let wasm: Promise<Uint8Array> | undefined;
  let fallback: Promise<ImageProcessor> | undefined;
  const onThread = (bytes: Uint8Array, mimeType: string, limits: ImageLimits) =>
    Effect.promise(() => {
      wasm ??= readPhotonWasm();
      thread ??= wasm.then((module) =>
        startPhotonThread({
          wasm: module,
          idleMs,
          onExit: () => {
            thread = undefined;
          },
        }),
      );
      return thread.then((started) => started.prepare(bytes, mimeType, limits));
    }).pipe(
      Effect.catchDefect((defect) => {
        if (!(defect instanceof WorkerUnavailable)) return Effect.die(defect);
        fallback = inProcess();
        return prepareWith(fallback, bytes, mimeType, limits);
      }),
    );
  return {
    prepare: (bytes, mimeType, limits) =>
      Effect.runPromise(
        fallback === undefined
          ? onThread(bytes, mimeType, limits)
          : prepareWith(fallback, bytes, mimeType, limits),
      ),
  };
}

export const createNodePhotonImages = (
  options: NodePhotonImagesOptions = {},
): Promise<ImageProcessor> =>
  options.worker === false ? inProcess() : Promise.resolve().then(() => threaded(options));

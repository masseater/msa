import { createRequire } from "node:module";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime } from "effect";

import type imageTypes from "../tools/image.types.ts";
import imagesModule from "./index.ts";
import nodeThread from "./node-thread.ts";
import type nodeThreadTypes from "./node-thread.types.ts";
import type nodeTypes from "./node.types.ts";

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

const { createPhotonImages } = imagesModule;
const { WorkerUnavailable, startPhotonThread } = nodeThread;

const readPhotonWasm = (): Promise<Uint8Array> =>
  nodeRuntime.runPromise(
    FileSystem.FileSystem.use((fs) =>
      fs.readFile(
        createRequire(import.meta.url).resolve("@silvia-odwyer/photon/photon_rs_bg.wasm"),
      ),
    ).pipe(Effect.mapError((error) => error.cause ?? error)),
  );

const inProcess = (): Promise<imageTypes.ImageProcessor> =>
  readPhotonWasm().then((wasm) => createPhotonImages(wasm));

const prepareWith = (
  processor: Promise<imageTypes.ImageProcessor>,
  bytes: Uint8Array,
  mimeType: string,
  limits: imageTypes.ImageLimits,
) =>
  Effect.flatMap(
    Effect.promise(() => processor),
    (images) => Effect.promise(() => images.prepare(bytes, mimeType, limits)),
  );

function threaded(options: nodeTypes.NodePhotonImagesOptions): imageTypes.ImageProcessor {
  const idleMs = options.idleMs ?? 30_000;
  let thread: Promise<nodeThreadTypes.PhotonThread> | undefined;
  let wasm: Promise<Uint8Array> | undefined;
  let fallback: Promise<imageTypes.ImageProcessor> | undefined;
  const onThread = (bytes: Uint8Array, mimeType: string, limits: imageTypes.ImageLimits) =>
    Effect.promise(() => {
      wasm ??= readPhotonWasm();
      thread ??= wasm.then((module) =>
        startPhotonThread({
          idleMs,
          onExit: () => {
            thread = undefined;
          },
          wasm: module,
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

const createNodePhotonImages = (
  options: nodeTypes.NodePhotonImagesOptions = {},
): Promise<imageTypes.ImageProcessor> =>
  options.worker === false ? inProcess() : Promise.resolve().then(() => threaded(options));

const node = {
  createNodePhotonImages,
};

export default node;

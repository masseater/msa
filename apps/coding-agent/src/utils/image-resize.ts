import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import config from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import Worker from "../core/platform/node/worker.ts";
import imageResizeCore from "./image-resize-core.ts";
import type imageResizeCoreTypes from "./image-resize-core.types.ts";
import interop from "./interop.ts";
import photon from "./photon.ts";

const { IMAGE_RESIZE_WORKER_RESPONSE_TYPE, resizeImageInProcess } = imageResizeCore;
const { awaited, awaiting } = awaitingModule;
const { callbackPromise } = interop;
const { isBunBinary } = config;

function toTransferableBytes(input: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(input);
}

function isResizeImageWorkerResponse(
  value: unknown,
): value is imageResizeCoreTypes.ResizeImageWorkerResponse {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    value.type === IMAGE_RESIZE_WORKER_RESPONSE_TYPE
  );
}

function createResizeWorker(workerSpecifier: string | URL): Worker {
  return new Worker(workerSpecifier);
}

interface WorkerRequest {
  inputBytes: ReturnType<typeof toTransferableBytes>;
  mimeType: string;
  options: imageResizeCoreTypes.ImageResizeOptions | undefined;
  photonWasmPath: string | undefined;
}

function awaitWorkerResult(
  worker: Worker,
  request: WorkerRequest,
): Promise<imageResizeCoreTypes.ResizedImage | null> {
  return callbackPromise<imageResizeCoreTypes.ResizedImage | null>((resolve, reject) => {
    let settled = false;
    const settle = (result: imageResizeCoreTypes.ResizedImage | null): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    worker.on("message", (message: unknown) => {
      if (!isResizeImageWorkerResponse(message)) return;
      if ("error" in message) fail(new Error(message.error));
      else settle(message.result);
    });
    worker.once("error", fail);
    worker.once("exit", (code) => {
      if (!settled) fail(new Error(`Image resize worker exited with code ${code}`));
    });
    worker.postMessage(request, [request.inputBytes.buffer]);
  });
}

function resizeImageWith(
  workerSpecifier: string | URL,
  inputBytes: Uint8Array,
  mimeType: string,
  options?: imageResizeCoreTypes.ImageResizeOptions,
): Promise<imageResizeCoreTypes.ResizedImage | null> {
  return Effect.runPromise(
    awaiting(function* () {
      const worker = createResizeWorker(workerSpecifier);
      try {
        return yield* awaited(
          awaitWorkerResult(worker, {
            inputBytes: toTransferableBytes(inputBytes),
            mimeType,
            options,
            photonWasmPath: photon.getEmbeddedWasmPath(),
          }),
        );
      } finally {
        void worker.terminate().catch(() => undefined);
      }
    }),
  );
}

const BINARY_WORKER_ENTRY = "./utils/image-resize-worker.js";

function resizeWorkerEntry(): string | URL {
  if (isBunBinary) return BINARY_WORKER_ENTRY;
  return new URL(
    import.meta.url.endsWith(".ts") ? "./image-resize-worker.ts" : "./image-resize-worker.js",
    import.meta.url,
  );
}

function resizeImageInWorkerImpl(
  inputBytes: Uint8Array,
  mimeType: string,
  options?: imageResizeCoreTypes.ImageResizeOptions,
): Promise<imageResizeCoreTypes.ResizedImage | null> {
  return resizeImageWith(resizeWorkerEntry(), inputBytes, mimeType, options);
}

function resizeImageImpl(
  inputBytes: Uint8Array,
  mimeType: string,
  options?: imageResizeCoreTypes.ImageResizeOptions,
): Promise<imageResizeCoreTypes.ResizedImage | null> {
  return resizeImageInWorkerImpl(inputBytes, mimeType, options).catch(() =>
    resizeImageInProcess(inputBytes, mimeType, options),
  );
}

const resizeImageInWorker: {
  (
    inputBytes: Uint8Array,
    mimeType: string,
    options?: imageResizeCoreTypes.ImageResizeOptions,
  ): Promise<imageResizeCoreTypes.ResizedImage | null>;
  (
    mimeType: string,
    options?: imageResizeCoreTypes.ImageResizeOptions,
  ): (inputBytes: Uint8Array) => Promise<imageResizeCoreTypes.ResizedImage | null>;
} = dual((args: IArguments) => args[0] instanceof Uint8Array, resizeImageInWorkerImpl);

const resizeImage: {
  (
    inputBytes: Uint8Array,
    mimeType: string,
    options?: imageResizeCoreTypes.ImageResizeOptions,
  ): Promise<imageResizeCoreTypes.ResizedImage | null>;
  (
    mimeType: string,
    options?: imageResizeCoreTypes.ImageResizeOptions,
  ): (inputBytes: Uint8Array) => Promise<imageResizeCoreTypes.ResizedImage | null>;
} = dual((args: IArguments) => args.length >= 2, resizeImageImpl);

function formatDimensionNote(result: imageResizeCoreTypes.ResizedImage): string | undefined {
  if (!result.wasResized) {
    return undefined;
  }

  const scale = result.originalWidth / result.width;
  return `[Image: original ${result.originalWidth}x${result.originalHeight}, displayed at ${result.width}x${result.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`;
}

const imageResize = {
  formatDimensionNote,
  resizeImage,
  resizeImageInWorker,
};

export default imageResize;

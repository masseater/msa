import { Worker } from "node:worker_threads";

import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../core/awaiting.ts";
import imageResizeCore from "./image-resize-core.ts";
import type imageResizeCoreTypes from "./image-resize-core.types.ts";
import interop from "./interop.ts";

const { IMAGE_RESIZE_WORKER_RESPONSE_TYPE, resizeImageInProcess } = imageResizeCore;
const { awaited, awaiting } = awaitingModule;
const { callbackPromise } = interop;

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

function resizeImageInWorker(
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
          }),
        );
      } finally {
        void worker.terminate().catch(() => undefined);
      }
    }),
  );
}

function resizeImageImpl(
  inputBytes: Uint8Array,
  mimeType: string,
  options?: imageResizeCoreTypes.ImageResizeOptions,
): Promise<imageResizeCoreTypes.ResizedImage | null> {
  return Effect.runPromise(
    awaiting(function* () {
      const isTypeScriptRuntime = import.meta.url.endsWith(".ts");
      const workerUrl = new URL(
        isTypeScriptRuntime ? "./image-resize-worker.ts" : "./image-resize-worker.js",
        import.meta.url,
      );

      if (typeof process.versions["bun"] === "string") {
        try {
          return yield* awaited(
            resizeImageInWorker(
              "./src/utils/image-resize-worker.ts",
              inputBytes,
              mimeType,
              options,
            ),
          );
        } catch {}
      }

      try {
        return yield* awaited(resizeImageInWorker(workerUrl, inputBytes, mimeType, options));
      } catch {
        return yield* awaited(resizeImageInProcess(inputBytes, mimeType, options));
      }
    }),
  );
}

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
};

export default imageResize;

import { parentPort } from "node:worker_threads";

import * as Effect from "effect/Effect";

import awaitingModule from "../core/awaiting.ts";
import errors from "./errors.ts";
import imageResizeCore from "./image-resize-core.ts";
import type imageResizeCoreTypes from "./image-resize-core.types.ts";

const { IMAGE_RESIZE_WORKER_RESPONSE_TYPE, resizeImageInProcess } = imageResizeCore;
const { awaited, awaiting } = awaitingModule;
const { toErrorMessage } = errors;

interface ResizeImageWorkerRequest {
  inputBytes: Uint8Array;
  mimeType: string;
  options?: imageResizeCoreTypes.ImageResizeOptions;
}

function isResizeImageWorkerRequest(value: unknown): value is ResizeImageWorkerRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record["inputBytes"] instanceof Uint8Array && typeof record["mimeType"] === "string";
}

const port = parentPort;
if (port === null) {
  throw new Error("image resize worker requires parentPort");
}

port.once("message", (message: unknown) => {
  void (() =>
    Effect.runPromise(
      awaiting(function* () {
        try {
          if (!isResizeImageWorkerRequest(message)) {
            throw new Error("Invalid image resize worker request");
          }
          const result = yield* awaited(
            resizeImageInProcess(message.inputBytes, message.mimeType, message.options),
          );
          const response: imageResizeCoreTypes.ResizeImageWorkerResponse = {
            result,
            type: IMAGE_RESIZE_WORKER_RESPONSE_TYPE,
          };
          port.postMessage(response);
        } catch (error) {
          const response: imageResizeCoreTypes.ResizeImageWorkerResponse = {
            error: toErrorMessage(error),
            type: IMAGE_RESIZE_WORKER_RESPONSE_TYPE,
          };
          port.postMessage(response);
        }
      }),
    ))();
});

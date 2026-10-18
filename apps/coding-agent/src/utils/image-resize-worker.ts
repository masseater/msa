import { parentPort } from "node:worker_threads";

import { toErrorMessage } from "./errors.ts";
import {
  IMAGE_RESIZE_WORKER_RESPONSE_TYPE,
  type ImageResizeOptions,
  type ResizeImageWorkerResponse,
  resizeImageInProcess,
} from "./image-resize-core.ts";

interface ResizeImageWorkerRequest {
  inputBytes: Uint8Array;
  mimeType: string;
  options?: ImageResizeOptions;
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
  void (async () => {
    try {
      if (!isResizeImageWorkerRequest(message)) {
        throw new Error("Invalid image resize worker request");
      }
      const result = await resizeImageInProcess(
        message.inputBytes,
        message.mimeType,
        message.options,
      );
      const response: ResizeImageWorkerResponse = {
        type: IMAGE_RESIZE_WORKER_RESPONSE_TYPE,
        result,
      };
      port.postMessage(response);
    } catch (error) {
      const response: ResizeImageWorkerResponse = {
        type: IMAGE_RESIZE_WORKER_RESPONSE_TYPE,
        error: toErrorMessage(error),
      };
      port.postMessage(response);
    }
  })();
});

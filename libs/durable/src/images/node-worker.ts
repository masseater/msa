import { parentPort, workerData } from "node:worker_threads";

import type { ImageLimits, PreparedImage } from "../tools/image-processor.ts";
import { createPhotonImages } from "./index.ts";

export type PrepareRequest = {
  readonly id: number;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly limits: ImageLimits;
};

export type PrepareReply =
  | { readonly id: number; readonly result: PreparedImage | undefined }
  | { readonly id: number; readonly error: string };

const port = parentPort;
if (port === null) throw new Error("The Photon image worker needs a parent thread");
const images = createPhotonImages(workerData as Uint8Array);
port.on("message", (request: PrepareRequest) => {
  void images.prepare(request.bytes, request.mimeType, request.limits).then(
    (result) => port.postMessage({ id: request.id, result } satisfies PrepareReply),
    (error: unknown) =>
      port.postMessage({
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
      } satisfies PrepareReply),
  );
});

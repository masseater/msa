import { parentPort, workerData } from "node:worker_threads";

import imagesModule from "./index.ts";
import type nodeWorkerTypes from "./node-worker.types.ts";

const { createPhotonImages } = imagesModule;

const port = parentPort;
if (port === null) throw new Error("The Photon image worker needs a parent thread");
const images = createPhotonImages(workerData as Uint8Array);
port.on("message", (request: nodeWorkerTypes.PrepareRequest) => {
  void images.prepare(request.bytes, request.mimeType, request.limits).then(
    (result) => port.postMessage({ id: request.id, result } satisfies nodeWorkerTypes.PrepareReply),
    (error: unknown) =>
      port.postMessage({
        error: error instanceof Error ? error.message : String(error),
        id: request.id,
      } satisfies nodeWorkerTypes.PrepareReply),
  );
});

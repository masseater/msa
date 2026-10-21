import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import nodeFs from "../../core/platform/node/fs.ts";
import nodeStreamPromises from "../../core/platform/node/stream-promises.ts";
import nodeStream from "../../core/platform/node/stream.ts";
import managementHttp from "../management-http.ts";

const { createWriteStream } = nodeFs;
const { Readable } = nodeStream;
const { pipeline } = nodeStreamPromises;
const { fetchWithRetry } = managementHttp;
const { awaited, awaiting } = awaitingModule;

const DOWNLOAD_TIMEOUT_MS = 120_000;

function downloadFile(url: string, dest: string): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      const response = yield* awaited(
        fetchWithRetry(url, undefined, { timeoutMs: DOWNLOAD_TIMEOUT_MS }),
      );

      if (!response.ok) {
        throw new Error(`Download failed with HTTP ${response.status}: ${url}`);
      }

      if (response.body === null) {
        throw new Error("No response body");
      }

      const fileStream = createWriteStream(dest);
      yield* awaited(pipeline(Readable.fromWeb(response.body as any), fileStream));
    }),
  );
}

const downloadFileModule = { downloadFile };

export default downloadFileModule;

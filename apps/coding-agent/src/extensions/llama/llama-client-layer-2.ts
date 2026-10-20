import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import type clientTypes from "./client.types.ts";
import llamaClientHelpers from "./llama-client-helpers.ts";
import LlamaClientLayer1 from "./llama-client-layer-1.ts";

const { awaited, awaitingWith } = awaitingModule;
const { errorMessage, linkSignal, parseDownloadProgress, sleep } = llamaClientHelpers;

export default abstract class LlamaClientLayer2 extends LlamaClientLayer1 {
  downloadAndWait(
    model: string,
    onProgress: (progress: clientTypes.LlamaProgress) => void,
    signal?: AbortSignal,
  ): Promise<clientTypes.LlamaModelInfo[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const watcher = new AbortController();
        const unlink = linkSignal(signal, watcher);
        let finished = false;
        let failure: string | undefined;
        let sawDownloading = false;
        let polls = 0;
        void this.watch((event) => {
          if (event.model !== model) return;
          if (event.event === "download_finished") finished = true;
          if (event.event === "download_failed")
            failure = errorMessage(event.data, "Download failed");
          if (event.event === "download_progress") {
            sawDownloading = true;
            const progress = parseDownloadProgress(event.data);
            if (progress !== undefined) onProgress(progress);
          }
        }, watcher.signal).catch(() => {});
        try {
          yield* awaited(this.download(model, signal));
          onProgress({ message: "Downloading model" });
          while (true) {
            if (signal?.aborted === true) throw signal.reason ?? new Error("Cancelled");
            if (failure !== undefined && failure !== "") throw new Error(failure);
            const models = yield* awaited(this.list({ signal }));
            polls++;
            const entry = models.find((candidate) => candidate.id === model);
            if (entry?.status.value === "downloading") {
              sawDownloading = true;
              const progress = parseDownloadProgress(entry.status.progress);
              if (progress !== undefined) onProgress(progress);
            } else if (finished || (entry !== undefined && (sawDownloading || polls >= 2))) {
              return yield* awaited(this.list({ reload: true, signal }));
            }
            yield* awaited(sleep(500, signal));
          }
        } finally {
          unlink();
          watcher.abort();
        }
      }, this),
    );
  }
}

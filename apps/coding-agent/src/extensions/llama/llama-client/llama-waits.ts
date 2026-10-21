import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import type clientTypes from "../client.types.ts";
import llamaClientHelpers from "../llama-client-helpers.ts";
import type LlamaClient from "../llama-client.ts";

const { awaited, awaitingWith } = awaitingModule;
const { errorMessage, linkSignal, parseLoadProgress, sleep, parseDownloadProgress } =
  llamaClientHelpers;

export default class LlamaWaits {
  private readonly client: LlamaClient;

  constructor(client: LlamaClient) {
    this.client = client;
  }

  unloadAndWait(model: string, signal?: AbortSignal): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.client.unload(model, signal));
        while (true) {
          const entry = (yield* awaited(this.client.list({ signal }))).find(
            (candidate) => candidate.id === model,
          );
          if (entry === undefined || entry.status.value === "unloaded") return;
          yield* awaited(sleep(100, signal));
        }
      }, this),
    );
  }

  loadAndWait(
    model: string,
    onProgress: (progress: clientTypes.LlamaProgress) => void,
    signal?: AbortSignal,
  ): Promise<clientTypes.LlamaModelInfo> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const watcher = new AbortController();
        const unlink = linkSignal(signal, watcher);
        let eventLoaded = false;
        let eventError: string | undefined;
        void this.client
          .watch((event) => {
            if (event.model !== model) return;
            if (event.event !== "model_status" && event.event !== "status_change") return;
            const data = event.data as { status?: unknown } | undefined;
            if (data?.status === "loaded") eventLoaded = true;
            if (data?.status === "unloaded") eventError = "Model failed to load";
            const progress = parseLoadProgress(event.data);
            if (progress !== undefined) onProgress(progress);
          }, watcher.signal)
          .catch(() => {});
        try {
          yield* awaited(this.client.load(model, signal));
          onProgress({ message: "Loading model" });
          while (true) {
            if (signal?.aborted === true) throw signal.reason ?? new Error("Cancelled");
            const entry = (yield* awaited(this.client.list({ signal }))).find(
              (candidate) => candidate.id === model,
            );
            if (entry?.status.value === "loaded") return entry;
            if (eventLoaded && entry === undefined)
              return { id: model, status: { value: "loaded" } };
            if (entry?.status.failed === true || (eventError !== undefined && eventError !== "")) {
              throw new Error(
                entry?.status.exit_code === undefined
                  ? (eventError ?? "Model failed to load")
                  : `Model exited with code ${entry.status.exit_code}`,
              );
            }
            yield* awaited(sleep(250, signal));
          }
        } finally {
          unlink();
          watcher.abort();
        }
      }, this),
    );
  }

  downloadAndWait(
    model: string,
    onProgress: (progress: clientTypes.LlamaProgress) => void,
    signal?: AbortSignal,
  ): Promise<clientTypes.LlamaModelInfo[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const { state, stop } = this.watchDownload(model, onProgress, signal);
        let polls = 0;
        try {
          yield* awaited(this.client.download(model, signal));
          onProgress({ message: "Downloading model" });
          while (true) {
            if (signal?.aborted === true) throw signal.reason ?? new Error("Cancelled");
            if (state.failure !== undefined && state.failure !== "") throw new Error(state.failure);
            const models = yield* awaited(this.client.list({ signal }));
            polls++;
            const entry = models.find((candidate) => candidate.id === model);
            if (entry?.status.value === "downloading") {
              state.sawDownloading = true;
              const progress = parseDownloadProgress(entry.status.progress);
              if (progress !== undefined) onProgress(progress);
            } else if (
              state.finished ||
              (entry !== undefined && (state.sawDownloading || polls >= 2))
            ) {
              return yield* awaited(this.client.list({ reload: true, signal }));
            }
            yield* awaited(sleep(500, signal));
          }
        } finally {
          stop();
        }
      }, this),
    );
  }

  private watchDownload(
    model: string,
    onProgress: (progress: clientTypes.LlamaProgress) => void,
    signal: AbortSignal | undefined,
  ): {
    state: { failure: string | undefined; finished: boolean; sawDownloading: boolean };
    stop: () => void;
  } {
    const watcher = new AbortController();
    const unlink = linkSignal(signal, watcher);
    const state = {
      failure: undefined as string | undefined,
      finished: false,
      sawDownloading: false,
    };
    void this.client
      .watch((event) => {
        if (event.model !== model) return;
        if (event.event === "download_finished") state.finished = true;
        if (event.event === "download_failed")
          state.failure = errorMessage(event.data, "Download failed");
        if (event.event === "download_progress") {
          state.sawDownloading = true;
          const progress = parseDownloadProgress(event.data);
          if (progress !== undefined) onProgress(progress);
        }
      }, watcher.signal)
      .catch(() => {});
    return {
      state,
      stop: () => {
        unlink();
        watcher.abort();
      },
    };
  }
}

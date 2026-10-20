import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import interop from "../../utils/interop.ts";
import type clientTypes from "./client.types.ts";
import llamaClientHelpers from "./llama-client-helpers.ts";
import LlamaClientLayer0 from "./llama-client-layer-0.ts";

const { awaited, awaitingWith } = awaitingModule;
const { fetchResponse } = interop;
const { errorMessage, isModelInfo, linkSignal, parseLoadProgress, parseModelEvent, sleep } =
  llamaClientHelpers;

export default abstract class LlamaClientLayer1 extends LlamaClientLayer0 {
  protected request(path: string, init: RequestInit = {}): Promise<unknown> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const headers = new Headers(init.headers);
        if (init.body !== undefined) headers.set("Content-Type", "application/json");
        if (this.apiKey !== undefined && this.apiKey !== "")
          headers.set("Authorization", `Bearer ${this.apiKey}`);
        const timeout = AbortSignal.timeout(15_000);
        const signal =
          init.signal !== undefined && init.signal !== null
            ? AbortSignal.any([init.signal, timeout])
            : timeout;
        const response = yield* awaited(
          fetchResponse(`${this.serverUrl}${path}`, { ...init, headers, signal }),
        );
        let payload: unknown;
        try {
          payload = yield* awaited(response.json());
        } catch {
          payload = undefined;
        }
        if (!response.ok)
          throw new Error(errorMessage(payload, `llama.cpp returned HTTP ${response.status}`));
        return payload;
      }, this),
    );
  }

  list(
    options: { reload?: boolean; signal?: AbortSignal | undefined } = {},
  ): Promise<clientTypes.LlamaModelInfo[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const payload = yield* awaited(
          this.request(`/models${options.reload === true ? "?reload=1" : ""}`, {
            signal: options.signal ?? null,
          }),
        );
        if (
          typeof payload !== "object" ||
          payload === null ||
          !Array.isArray((payload as { data?: unknown }).data)
        ) {
          throw new Error("llama.cpp returned an invalid model catalog");
        }
        const data = (payload as { data: unknown[] }).data;
        if (!data.every(isModelInfo))
          throw new Error("Server is not running in llama.cpp router mode");
        return data;
      }, this),
    );
  }

  props(
    options: { model?: string; signal?: AbortSignal } = {},
  ): Promise<clientTypes.LlamaServerProps> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const query =
          options.model !== undefined && options.model !== ""
            ? `?${new URLSearchParams({ autoload: "false", model: options.model })}`
            : "";
        const payload = yield* awaited(
          this.request(`/props${query}`, { signal: options.signal ?? null }),
        );
        if (typeof payload !== "object" || payload === null) return {};
        const { models_autoload: modelsAutoload, chat_template: chatTemplate } = payload as Record<
          string,
          unknown
        >;
        return {
          ...(typeof modelsAutoload === "boolean" ? { models_autoload: modelsAutoload } : {}),
          ...(typeof chatTemplate === "string" ? { chat_template: chatTemplate } : {}),
        };
      }, this),
    );
  }

  load(model: string, signal?: AbortSignal): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(
          this.request("/models/load", {
            body: JSON.stringify({ model }),
            method: "POST",
            signal: signal ?? null,
          }),
        );
      }, this),
    );
  }

  unload(model: string, signal?: AbortSignal): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(
          this.request("/models/unload", {
            body: JSON.stringify({ model }),
            method: "POST",
            signal: signal ?? null,
          }),
        );
      }, this),
    );
  }

  unloadAndWait(model: string, signal?: AbortSignal): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.unload(model, signal));
        while (true) {
          const entry = (yield* awaited(this.list({ signal }))).find(
            (candidate) => candidate.id === model,
          );
          if (entry === undefined || entry.status.value === "unloaded") return;
          yield* awaited(sleep(100, signal));
        }
      }, this),
    );
  }

  download(model: string, signal?: AbortSignal): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(
          this.request("/models", {
            body: JSON.stringify({ model }),
            method: "POST",
            signal: signal ?? null,
          }),
        );
      }, this),
    );
  }

  watch(
    onEvent: (event: clientTypes.LlamaModelEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const headers = new Headers();
        if (this.apiKey !== undefined && this.apiKey !== "")
          headers.set("Authorization", `Bearer ${this.apiKey}`);
        const response = yield* awaited(
          fetchResponse(`${this.serverUrl}/models/sse`, {
            headers,
            signal: signal ?? null,
          }),
        );
        if (!response.ok || response.body === null)
          throw new Error(`llama.cpp SSE returned HTTP ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const chunk = yield* awaited(reader.read());
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            const event = data === "" ? undefined : parseModelEvent(data);
            if (event !== undefined) onEvent(event);
            boundary = buffer.indexOf("\n\n");
          }
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
        void this.watch((event) => {
          if (event.model !== model) return;
          if (event.event !== "model_status" && event.event !== "status_change") return;
          const data = event.data as { status?: unknown } | undefined;
          if (data?.status === "loaded") eventLoaded = true;
          if (data?.status === "unloaded") eventError = "Model failed to load";
          const progress = parseLoadProgress(event.data);
          if (progress !== undefined) onProgress(progress);
        }, watcher.signal).catch(() => {});
        try {
          yield* awaited(this.load(model, signal));
          onProgress({ message: "Loading model" });
          while (true) {
            if (signal?.aborted === true) throw signal.reason ?? new Error("Cancelled");
            const entry = (yield* awaited(this.list({ signal }))).find(
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
}

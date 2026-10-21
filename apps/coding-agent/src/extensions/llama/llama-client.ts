import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import interop from "../../utils/interop.ts";
import client from "./client.ts";
import type clientTypes from "./client.types.ts";
import llamaClientHelpers from "./llama-client-helpers.ts";
import LlamaWaits from "./llama-client/llama-waits.ts";

const { normalizeLlamaServerUrl } = client;
const { awaited, awaitingWith } = awaitingModule;
const { fetchResponse } = interop;
const { errorMessage, isModelInfo, parseModelEvent } = llamaClientHelpers;

export default class LlamaClient {
  readonly waits: LlamaWaits;

  serverUrl!: string;

  private apiKey!: string | undefined;

  private request(path: string, init: RequestInit = {}): Promise<unknown> {
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
    ...args: Parameters<LlamaWaits["loadAndWait"]>
  ): ReturnType<LlamaWaits["loadAndWait"]> {
    return this.waits.loadAndWait(...args);
  }

  downloadAndWait(
    ...args: Parameters<LlamaWaits["downloadAndWait"]>
  ): ReturnType<LlamaWaits["downloadAndWait"]> {
    return this.waits.downloadAndWait(...args);
  }

  unloadAndWait(
    ...args: Parameters<LlamaWaits["unloadAndWait"]>
  ): ReturnType<LlamaWaits["unloadAndWait"]> {
    return this.waits.unloadAndWait(...args);
  }

  constructor(serverUrl: string, apiKey?: string) {
    this.waits = new LlamaWaits(this);
    this.serverUrl = normalizeLlamaServerUrl(serverUrl);
    this.apiKey = apiKey;
  }
}

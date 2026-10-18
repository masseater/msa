import * as Effect from "effect/Effect";

import { awaited, awaiting } from "../../core/awaiting.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "../../core/extensions/types.ts";
import { toErrorMessage } from "../../utils/errors.ts";
import {
  formatBytes,
  LlamaClient,
  type LlamaModelInfo,
  normalizeLlamaServerUrl,
} from "./client.ts";
import { findHuggingFaceToken, HuggingFaceClient } from "./huggingface.ts";
import { createLlamaProvider, LLAMA_PROVIDER_ID } from "./provider.ts";
import { type LlamaUi, runWithProgress, showLlamaUi } from "./ui.ts";

function modelIsLoaded(model: LlamaModelInfo): boolean {
  return model.status.value === "loaded" || model.status.value === "sleeping";
}

function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = `${error.name} ${error.message}`.toLowerCase();
  return (
    message.includes("fetch failed") || message.includes("timeout") || message.includes("network")
  );
}

function connectionErrorMessage(error: unknown): string {
  if (isConnectionError(error)) return "Could not connect to the server.";
  return toErrorMessage(error);
}

function parseHuggingFaceModel(value: string): { repository: string; quantization?: string } {
  const colon = value.indexOf(":", value.indexOf("/") + 1);
  return colon < 0
    ? { repository: value }
    : { repository: value.slice(0, colon), quantization: value.slice(colon + 1) };
}

function configuredClient(ctx: ExtensionCommandContext): Promise<LlamaClient | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const result = yield* awaited(ctx.modelRegistry.getProviderAuth(LLAMA_PROVIDER_ID));
      if (result === undefined) {
        ctx.ui.notify(`Configure llama.cpp with /login ${LLAMA_PROVIDER_ID}`, "warning");
        return undefined;
      }
      const configuredUrl = result.env?.["LLAMA_BASE_URL"];
      const serverUrl = normalizeLlamaServerUrl(
        typeof configuredUrl === "string" && configuredUrl !== ""
          ? configuredUrl
          : (result.auth.baseUrl ?? ""),
      );
      return new LlamaClient(serverUrl, result.auth.apiKey);
    }),
  );
}

export default function llamaExtension(msa: ExtensionAPI): void {
  const provider = createLlamaProvider();
  msa.registerProvider(provider.provider);

  const syncCatalog = (
    ctx: ExtensionCommandContext,
    client: LlamaClient,
    catalog?: LlamaModelInfo[],
  ): Promise<LlamaModelInfo[]> =>
    Effect.runPromise(
      awaiting(function* () {
        const signal = AbortSignal.timeout(15_000);
        const current = catalog ?? (yield* awaited(client.list({ signal })));
        provider.setCatalog(current, client.serverUrl);
        const result = yield* awaited(
          ctx.modelRegistry.refresh({
            providers: [LLAMA_PROVIDER_ID],

            allowNetwork: true,
            signal,
          }),
        );
        if (result.aborted) throw new Error("Model catalog refresh timed out.");
        const refreshError = result.errors.get(LLAMA_PROVIDER_ID);
        if (refreshError !== undefined) throw refreshError;
        return current;
      }),
    );

  const loadModel = (
    ctx: ExtensionCommandContext,
    ui: LlamaUi,
    client: LlamaClient,
    catalog: LlamaModelInfo[],
    target: LlamaModelInfo,
  ): Promise<void> =>
    Effect.runPromise(
      awaiting(function* () {
        const loaded = catalog.filter((model) => model.id !== target.id && modelIsLoaded(model));
        let replace = false;
        if (loaded.length > 0) {
          const choice = yield* awaited(
            ui.select(`${loaded.length} model${loaded.length === 1 ? " is" : "s are"} loaded`, [
              "Unload all and load",
              "Keep loaded and load",
              "Cancel",
            ]),
          );
          if (choice === undefined || choice === "" || choice === "Cancel") return;
          replace = choice === "Unload all and load";
        }

        const restoreLoaded = (): Promise<void> =>
          Effect.runPromise(
            awaiting(function* () {
              ctx.ui.notify("Restoring previously loaded models");
              for (const model of loaded) yield* awaited(client.loadAndWait(model.id, () => {}));
              yield* awaited(syncCatalog(ctx, client));
            }),
          );
        if (replace) {
          for (const model of loaded) yield* awaited(client.unloadAndWait(model.id));
        }

        try {
          const result = yield* awaited(
            runWithProgress(ui, {
              title: "Loading model",
              model: target.id,
              initialMessage: "Starting…",
              cancelTitle: "Stop loading?",
              cancelMessage: target.id,
              run: (signal, update) => client.loadAndWait(target.id, update, signal),
              cancel: () => client.unload(target.id),
            }),
          );
          if (result.cancelled) {
            if (replace) yield* awaited(restoreLoaded());
            return;
          }
          const refreshed = yield* awaited(syncCatalog(ctx, client));
          const loadedModel = refreshed.find((model) => model.id === target.id);
          ctx.ui.notify(
            loadedModel?.status.value === "loaded"
              ? `Loaded ${target.id}`
              : `Load started for ${target.id}`,
          );
        } catch (error) {
          if (replace) {
            try {
              yield* awaited(restoreLoaded());
            } catch {}
          }
          throw error;
        }
      }),
    );

  const unloadModel = (
    ctx: ExtensionCommandContext,
    ui: LlamaUi,
    client: LlamaClient,
    model: LlamaModelInfo,
  ): Promise<void> =>
    Effect.runPromise(
      awaiting(function* () {
        if (!(yield* awaited(ui.confirm("Unload model?", model.id)))) return;
        yield* awaited(client.unloadAndWait(model.id));
        yield* awaited(syncCatalog(ctx, client));
        ctx.ui.notify(`Unloaded ${model.id}`);
      }),
    );

  const downloadModel = (
    ctx: ExtensionCommandContext,
    ui: LlamaUi,
    client: LlamaClient,
  ): Promise<void> =>
    Effect.runPromise(
      awaiting(function* () {
        const huggingFace = new HuggingFaceClient(yield* awaited(findHuggingFaceToken()));
        const selected = yield* awaited(
          ui.searchModels((query, signal) => huggingFace.search(query, signal)),
        );
        if (selected === undefined || selected === "") return;
        const parsed = parseHuggingFaceModel(selected);
        ui.showStatus("Loading model details", parsed.repository);
        const details = yield* awaited(huggingFace.details(parsed.repository));
        if (details.gated !== false) {
          const approval =
            details.gated === "manual" ? "Manual approval is required" : "Accept the access terms";
          const choice = yield* awaited(
            ui.select(
              `Hugging Face access required\n${details.id}\n\n${approval} at:\nhttps://huggingface.co/${details.id}\n\nThe llama.cpp server needs HF_TOKEN with access.`,
              ["Continue", "Back"],
            ),
          );
          if (choice !== "Continue") return;
        }
        let quantization = parsed.quantization;
        if (
          (quantization === undefined || quantization === "") &&
          details.quantizations.length > 0
        ) {
          const options = details.quantizations.map((entry) => {
            const detail = [
              entry.size === undefined ? undefined : formatBytes(entry.size),
              entry.name === "Q4_K_M" ? "recommended" : undefined,
            ]
              .filter((value): value is string => Boolean(value))
              .join(" · ");
            return detail === "" ? entry.name : `${entry.name} · ${detail}`;
          });
          const choice = yield* awaited(ui.select(`Select quantization\n${details.id}`, options));
          if (choice === undefined || choice === "") return;
          quantization = details.quantizations[options.indexOf(choice)]?.name;
          if (quantization === undefined || quantization === "") return;
        }
        const model =
          quantization !== undefined && quantization !== ""
            ? `${details.id}:${quantization}`
            : details.id;
        const result = yield* awaited(
          runWithProgress(ui, {
            title: "Downloading model",
            model,
            initialMessage: "Starting…",
            cancelTitle: "Stop download?",
            cancelMessage: model,
            run: (signal, update) => client.downloadAndWait(model, update, signal),
            cancel: () => client.unload(model),
          }),
        );
        if (result.cancelled) return;
        yield* awaited(syncCatalog(ctx, client, result.value));
        ctx.ui.notify(`Downloaded ${model}`);
      }),
    );

  msa.registerCommand("llama", {
    description: "Manage llama.cpp router models",
    handler: (_args, ctx) =>
      Effect.runPromise(
        awaiting(function* () {
          if (ctx.mode !== "tui") {
            ctx.ui.notify("/llama is available in interactive mode", "warning");
            return;
          }
          const client = yield* awaited(configuredClient(ctx));
          if (client === undefined) return;
          yield* awaited(
            showLlamaUi(ctx, (ui) =>
              Effect.runPromise(
                awaiting(function* () {
                  const readCatalog = (): Promise<LlamaModelInfo[] | undefined> =>
                    Effect.runPromise(
                      awaiting(function* () {
                        while (true) {
                          try {
                            return yield* awaited(syncCatalog(ctx, client));
                          } catch (error) {
                            if (
                              (yield* awaited(
                                ui.connectionError(client.serverUrl, connectionErrorMessage(error)),
                              )) === "close"
                            ) {
                              return undefined;
                            }
                          }
                        }
                      }),
                    );

                  let catalog = yield* awaited(readCatalog());
                  if (catalog === undefined) return;
                  while (true) {
                    const action = yield* awaited(ui.showModels(client.serverUrl, catalog));
                    if (action.type === "close") return;
                    let actionError: unknown;
                    try {
                      if (action.type === "download")
                        yield* awaited(downloadModel(ctx, ui, client));
                      else if (modelIsLoaded(action.model))
                        yield* awaited(unloadModel(ctx, ui, client, action.model));
                      else if (action.model.status.value === "unloaded")
                        yield* awaited(loadModel(ctx, ui, client, catalog, action.model));
                      else
                        ctx.ui.notify(
                          `${action.model.id} is ${action.model.status.value}`,
                          "warning",
                        );
                    } catch (error) {
                      actionError = error;
                    }
                    const refreshed = yield* awaited(readCatalog());
                    if (refreshed === undefined) return;
                    catalog = refreshed;
                    if (actionError !== undefined && !isConnectionError(actionError)) {
                      ctx.ui.notify(toErrorMessage(actionError), "error");
                    }
                  }
                }),
              ),
            ),
          );
        }),
      ),
  });
}

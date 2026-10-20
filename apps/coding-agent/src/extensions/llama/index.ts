import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import type typesContextTypes from "../../core/extensions/types-context.ts";
import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import errorsModule from "../../utils/errors.ts";
import clientModule from "./client.ts";
import type clientTypes from "./client.types.ts";
import HuggingFaceClient from "./hugging-face-client.ts";
import huggingface from "./huggingface.ts";
import type huggingfaceTypes from "./huggingface.types.ts";
import LlamaClient from "./llama-client.ts";
import providerModule from "./provider.ts";
import uiModule from "./ui.ts";
import type uiTypes from "./ui.types.ts";

const { formatBytes, normalizeLlamaServerUrl } = clientModule;
const { toErrorMessage } = errorsModule;
const { awaited, awaiting } = awaitingModule;
const { LLAMA_PROVIDER_ID, createLlamaProvider } = providerModule;
const { runWithProgress, showLlamaUi } = uiModule;
const { findHuggingFaceToken } = huggingface;

function modelIsLoaded(model: clientTypes.LlamaModelInfo): boolean {
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
    : { quantization: value.slice(colon + 1), repository: value.slice(0, colon) };
}

function configuredClient(
  ctx: extensionsTypesTypes.ExtensionCommandContext,
): Promise<clientTypes.LlamaClient | undefined> {
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

export default function llamaExtension(msa: extensionsTypesTypes.ExtensionAPI): void {
  const provider = createLlamaProvider();
  msa.registerProvider(provider.provider);

  const syncCatalog = (
    ctx: extensionsTypesTypes.ExtensionCommandContext,
    client: clientTypes.LlamaClient,
    catalog?: clientTypes.LlamaModelInfo[],
  ): Promise<clientTypes.LlamaModelInfo[]> =>
    Effect.runPromise(
      awaiting(function* () {
        const signal = AbortSignal.timeout(15_000);
        const current = catalog ?? (yield* awaited(client.list({ signal })));
        provider.setCatalog(current, client.serverUrl);
        const result = yield* awaited(
          ctx.modelRegistry.refresh({
            allowNetwork: true,

            providers: [LLAMA_PROVIDER_ID],

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
    ctx: extensionsTypesTypes.ExtensionCommandContext,
    ui: uiTypes.LlamaUi,
    client: clientTypes.LlamaClient,
    catalog: clientTypes.LlamaModelInfo[],
    target: clientTypes.LlamaModelInfo,
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
          const result = yield* loadModelPart1(ui, client, target);
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
    ctx: extensionsTypesTypes.ExtensionCommandContext,
    ui: uiTypes.LlamaUi,
    client: clientTypes.LlamaClient,
    model: clientTypes.LlamaModelInfo,
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
    ctx: extensionsTypesTypes.ExtensionCommandContext,
    ui: uiTypes.LlamaUi,
    client: clientTypes.LlamaClient,
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
        const { result, model } = yield* downloadModelPart1(quantization, details, ui, client);
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
                  const readCatalog = (): Promise<clientTypes.LlamaModelInfo[] | undefined> =>
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
                      yield* handlerPart1(
                        action,
                        downloadModel,
                        ctx,
                        ui,
                        client,
                        unloadModel,
                        loadModel,
                        catalog,
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

function* downloadModelPart1(
  quantization: string | undefined,
  details: huggingfaceTypes.HuggingFaceModelDetails,
  ui: uiTypes.LlamaUi,
  client: LlamaClient,
) {
  const model =
    quantization !== undefined && quantization !== ""
      ? `${details.id}:${quantization}`
      : details.id;
  const result = yield* awaited(
    runWithProgress(ui, {
      cancel: () => client.unload(model),
      cancelMessage: model,
      cancelTitle: "Stop download?",
      initialMessage: "Starting…",
      model,
      run: (signal, update) => client.downloadAndWait(model, update, signal),
      title: "Downloading model",
    }),
  );
  return { model, result };
}

function* handlerPart1(
  action: { type: "model"; model: clientTypes.LlamaModelInfo } | { type: "download" },
  downloadModel: (
    ctx: extensionsTypesTypes.ExtensionCommandContext,
    ui: uiTypes.LlamaUi,
    client: clientTypes.LlamaClient,
  ) => Promise<void>,
  ctx: typesContextTypes.ExtensionCommandContext,
  ui: uiTypes.LlamaUi,
  client: LlamaClient,
  unloadModel: (
    ctx: extensionsTypesTypes.ExtensionCommandContext,
    ui: uiTypes.LlamaUi,
    client: clientTypes.LlamaClient,
    model: clientTypes.LlamaModelInfo,
  ) => Promise<void>,
  loadModel: (
    ctx: extensionsTypesTypes.ExtensionCommandContext,
    ui: uiTypes.LlamaUi,
    client: clientTypes.LlamaClient,
    catalog: clientTypes.LlamaModelInfo[],
    target: clientTypes.LlamaModelInfo,
  ) => Promise<void>,
  catalog: clientTypes.LlamaModelInfo[],
) {
  if (action.type === "download") yield* awaited(downloadModel(ctx, ui, client));
  else if (modelIsLoaded(action.model)) yield* awaited(unloadModel(ctx, ui, client, action.model));
  else if (action.model.status.value === "unloaded")
    yield* awaited(loadModel(ctx, ui, client, catalog, action.model));
  else ctx.ui.notify(`${action.model.id} is ${action.model.status.value}`, "warning");
}

function* loadModelPart1(
  ui: uiTypes.LlamaUi,
  client: LlamaClient,
  target: clientTypes.LlamaModelInfo,
) {
  return yield* awaited(
    runWithProgress(ui, {
      cancel: () => client.unload(target.id),
      cancelMessage: target.id,
      cancelTitle: "Stop loading?",
      initialMessage: "Starting…",
      model: target.id,
      run: (signal, update) => client.loadAndWait(target.id, update, signal),
      title: "Loading model",
    }),
  );
}

import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import platform from "../../core/platform/index.ts";
import type clientTypes from "./client.types.ts";
import LlamaClient from "./llama-client.ts";
import llamaModels from "./llama-models.ts";
import type providerInternalTypes from "./provider-internal.types.ts";

const { awaited, awaiting, awaitingWith } = awaitingModule;
const { nowMs } = platform;
const { isModelType } = ai;
const {
  LLAMA_PROVIDER_ID,
  credentialServerUrl,
  isChatModel,
  isLlamaClassifierModel,
  modelIsSelectable,
  routerAutoloadEnabled,
  toMsaClassifierModel,
  toMsaModel,
} = llamaModels;

type ChatModel = aiTypes.Model<"openai-completions">;
type ClassifierModel = aiTypes.ClassifierModel<providerInternalTypes.LlamaClassifierApi>;
type ContextWindows = Map<string, number>;

export default class LlamaCatalog {
  models: readonly ChatModel[] = [];

  classifiers: readonly ClassifierModel[] = [];

  readonly setCatalog = (
    catalog: readonly clientTypes.LlamaModelInfo[],
    serverUrl: string,
    options: { routerAutoload?: boolean } = {},
  ): void => {
    const selectable = catalog.filter((model) =>
      modelIsSelectable(model, options.routerAutoload === true),
    );
    this.models = selectable.filter(isChatModel).map((model) => toMsaModel(model, serverUrl));
    this.classifiers = selectable.map((model) => toMsaClassifierModel(model, serverUrl));
  };

  refresh(context: aiTypes.RefreshModelsContext): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const contextWindows: ContextWindows = new Map();
        if (!(yield* awaited(this.restore(context, contextWindows)))) return;
        yield* awaited(this.fetch(context, contextWindows));
      }, this),
    );
  }

  private restore(
    context: aiTypes.RefreshModelsContext,
    contextWindows: ContextWindows,
  ): Promise<boolean> {
    if (context.stored === undefined) return Promise.resolve(true);
    const stored = context.stored.models.filter((model) => model.provider === LLAMA_PROVIDER_ID);
    const restored = stored.filter(
      (model): model is ChatModel =>
        isModelType(model, "chat") && model.api === "openai-completions",
    );
    const restoredClassifiers = stored.filter(isLlamaClassifierModel);
    for (const model of [...restored, ...restoredClassifiers]) {
      contextWindows.set(model.id, model.contextWindow);
    }
    return context.publish({
      update: () => {
        this.models = restored;
        this.classifiers = restoredClassifiers;
      },
    });
  }

  private fetch(
    context: aiTypes.RefreshModelsContext,
    contextWindows: ContextWindows,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const { credential, signal } = context;
        if (!context.allowNetwork || signal.aborted || credential?.type !== "api_key") return;
        const serverUrl = credentialServerUrl(credential);
        if (serverUrl === undefined || serverUrl === "") return;
        const client = new LlamaClient(serverUrl, credential.key);
        const catalog = yield* awaited(client.list({ signal }));
        if (signal.aborted) return;
        const routerAutoload = yield* awaited(routerAutoloadEnabled(client, catalog, signal));
        if (signal.aborted) return;
        const selectable = catalog.filter((model) => modelIsSelectable(model, routerAutoload));
        const refreshed = yield* awaited(
          Promise.all(
            selectable
              .filter(isChatModel)
              .map((model) => chatModelWithProps(client, model, serverUrl, contextWindows, signal)),
          ),
        );
        const refreshedClassifiers = selectable.map((model) =>
          toMsaClassifierModel(model, serverUrl, contextWindows.get(model.id)),
        );
        if (signal.aborted) return;
        yield* awaited(
          context.publish({
            persist: { checkedAt: nowMs(), models: [...refreshed, ...refreshedClassifiers] },
            update: () => {
              this.models = refreshed;
              this.classifiers = refreshedClassifiers;
            },
          }),
        );
      }, this),
    );
  }
}

function chatModelWithProps(
  client: LlamaClient,
  model: clientTypes.LlamaModelInfo,
  serverUrl: string,
  contextWindows: ContextWindows,
  signal: AbortSignal,
): Promise<ChatModel> {
  return Effect.runPromise(
    awaiting(function* () {
      const cachedContextWindow = contextWindows.get(model.id);
      if (model.status.value !== "loaded") {
        return toMsaModel(model, serverUrl, undefined, cachedContextWindow);
      }
      const props = yield* awaited(client.props({ model: model.id, signal }));
      return toMsaModel(model, serverUrl, props, cachedContextWindow);
    }),
  );
}

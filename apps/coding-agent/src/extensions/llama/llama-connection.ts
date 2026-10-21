import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import errorsModule from "../../utils/errors.ts";
import clientModule from "./client.ts";
import type clientTypes from "./client.types.ts";
import LlamaClient from "./llama-client.ts";
import providerModule from "./provider.ts";

const { normalizeLlamaServerUrl } = clientModule;
const { toErrorMessage } = errorsModule;
const { awaited, awaiting } = awaitingModule;
const { LLAMA_PROVIDER_ID } = providerModule;

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

const llamaConnection = {
  configuredClient,
  connectionErrorMessage,
  isConnectionError,
  modelIsLoaded,
};

export default llamaConnection;

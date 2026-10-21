import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import platform from "../../core/platform.ts";
import clientModule from "./client.ts";
import LlamaClient from "./llama-client.ts";
import llamaModels from "./llama-models.ts";

const { awaited, awaiting } = awaitingModule;
const { readEnv } = platform;
const { llamaInferenceUrl, normalizeLlamaServerUrl } = clientModule;
const { DEFAULT_LLAMA_SERVER_URL, resolveServerUrl } = llamaModels;

type ApiKeyAuth = NonNullable<aiTypes.Provider<"openai-completions">["auth"]["apiKey"]>;

const credentialSource = (credential: aiTypes.ApiKeyCredential | undefined) =>
  credential === undefined ? "LLAMA_BASE_URL" : "stored credential";

const check: ApiKeyAuth["check"] = ({ ctx, credential }) =>
  Effect.runPromise(
    awaiting(function* () {
      const serverUrl = yield* awaited(resolveServerUrl(ctx, credential));
      return serverUrl !== undefined && serverUrl !== ""
        ? { source: credentialSource(credential), type: "api_key" as const }
        : undefined;
    }),
  );

const login: ApiKeyAuth["login"] = (interaction): Promise<aiTypes.ApiKeyCredential> =>
  Effect.runPromise(
    awaiting(function* () {
      const enteredUrl = yield* awaited(
        interaction.prompt({
          message: "llama.cpp server URL",
          placeholder: readEnv("LLAMA_BASE_URL") ?? DEFAULT_LLAMA_SERVER_URL,
          type: "text",
        }),
      );
      const serverUrl = normalizeLlamaServerUrl(
        enteredUrl.trim() || readEnv("LLAMA_BASE_URL") || DEFAULT_LLAMA_SERVER_URL,
      );
      const apiKey = (yield* awaited(
        interaction.prompt({ message: "API key (optional)", type: "secret" }),
      )).trim();
      yield* awaited(
        new LlamaClient(serverUrl, apiKey || undefined).list({ signal: interaction.signal }),
      );
      return {
        env: { LLAMA_BASE_URL: serverUrl },
        key: apiKey || undefined,
        type: "api_key" as const,
      };
    }),
  );

const resolve: ApiKeyAuth["resolve"] = ({ ctx, credential }) =>
  Effect.runPromise(
    awaiting(function* () {
      const serverUrl = yield* awaited(resolveServerUrl(ctx, credential));
      if (serverUrl === undefined || serverUrl === "") return undefined;
      const apiKey = credential?.key ?? (yield* awaited(ctx.env("LLAMA_API_KEY"))) ?? "local";
      return {
        auth: { apiKey, baseUrl: llamaInferenceUrl(serverUrl) },
        env: { ...credential?.env, LLAMA_BASE_URL: serverUrl },
        source: credentialSource(credential),
      };
    }),
  );

const llamaApiKeyAuth: ApiKeyAuth = { check, login, name: "llama.cpp server", resolve };

const providerAuth = { llamaApiKeyAuth };

export default providerAuth;

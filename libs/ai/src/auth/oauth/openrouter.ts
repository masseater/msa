import { Effect } from "effect";

import cryptoModule from "../../utils/crypto.ts";
import http from "../../utils/http.ts";
import type httpTypes from "../../utils/http.types.ts";
import jsonCodec from "../../utils/json-codec.ts";
import providerEnv from "../../utils/provider-env.ts";
import type typesModule from "../types.ts";
import callbackServer from "./callback-server.ts";
import type callbackServerTypes from "./callback-server.types.ts";
import pkce from "./pkce.ts";

const { getProviderEnvValue } = providerEnv;
const { httpRequest } = http;
const { encodeJson } = jsonCodec;
const { startOAuthCallbackServer, waitForCallbackOrManualInput } = callbackServer;
const { generatePKCE } = pkce;
const { randomUuid } = cryptoModule;

const AUTHORIZE_URL = "https://openrouter.ai/auth";
const TOKEN_URL = "https://openrouter.ai/api/v1/auth/keys";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const TOKEN_EXCHANGE_TIMEOUT_MS = 30_000;

const getCallbackHost = (): string => getProviderEnvValue("MSA_OAUTH_CALLBACK_HOST") ?? "127.0.0.1";

type JsonObject = Record<string, unknown>;

function parseAuthorizationInput(input: string): string | undefined {
  const value = input.trim();
  if (value === "") return undefined;

  try {
    return new URL(value).searchParams.get("code") ?? undefined;
  } catch {}

  if (value.includes("code=")) {
    return new URLSearchParams(value).get("code") ?? undefined;
  }

  return value;
}

function errorDetail(body: JsonObject): string | undefined {
  if (typeof body["error_description"] === "string") return body["error_description"];
  if (typeof body["message"] === "string") return body["message"];
  if (typeof body["error"] === "string") return body["error"];
  const error = body["error"];
  if (error !== null && typeof error === "object" && !Array.isArray(error)) {
    const message = (error as JsonObject)["message"];
    if (typeof message === "string") return message;
  }
  return undefined;
}

const exchangeAuthorizationCode = (
  code: string,
  verifier: string,
  signal: AbortSignal,
): Effect.Effect<typesModule.OAuthCredential> =>
  Effect.gen(function* () {
    if (signal.aborted) return yield* Effect.die(new Error("Login cancelled"));
    const timeout = AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS);
    const reply = yield* httpRequest({
      body: yield* encodeJson({ code, code_challenge_method: "S256", code_verifier: verifier }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.any([signal, timeout]),
      url: TOKEN_URL,
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.die(
          signal.aborted
            ? new Error("Login cancelled", { cause: error })
            : timeout.aborted
              ? new Error("OpenRouter OAuth token exchange timed out", { cause: error })
              : (error as Error),
        ),
      ),
    );

    const body = yield* readJsonBody(reply);
    return yield* credentialFromBody(reply, body);
  });

const readJsonBody = (reply: httpTypes.HttpReply): Effect.Effect<JsonObject> =>
  reply.json.pipe(
    Effect.map((parsed) =>
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as JsonObject)
        : {},
    ),
    Effect.catchDefect(() =>
      reply.ok
        ? Effect.die(new Error("OpenRouter OAuth returned invalid JSON"))
        : Effect.succeed<JsonObject>({}),
    ),
  );

const credentialFromBody = (
  reply: httpTypes.HttpReply,
  body: JsonObject,
): Effect.Effect<typesModule.OAuthCredential> =>
  Effect.gen(function* () {
    if (!reply.ok) {
      const detail = errorDetail(body);
      return yield* Effect.die(
        new Error(
          `OpenRouter OAuth key exchange failed (HTTP ${reply.status})${detail !== undefined && detail !== "" ? `: ${detail}` : ""}`,
        ),
      );
    }

    const key = body["key"];
    if (typeof key !== "string" || key.length === 0) {
      return yield* Effect.die(new Error('OpenRouter OAuth response carries no "key"'));
    }

    return {
      access: key,
      expires: Number.MAX_SAFE_INTEGER,
      refresh: "",
      type: "oauth" as const,
    };
  });

const promptForManualCode = (
  interaction: typesModule.ProviderAuthInteraction,
  callback: callbackServerTypes.OAuthCallbackServer<typesModule.OAuthCredential>,
  verifier: string,
) =>
  Effect.gen(function* () {
    const result = yield* waitForCallbackOrManualInput({
      callback,
      interaction,
      message:
        "Complete sign-in in your browser, or paste the authorization code / redirect URL here:",
      placeholder: callback.redirectUri,
    });
    if (result.type === "callback") return result.value;
    const code = parseAuthorizationInput(result.input);
    if (code === undefined || code === "") {
      return yield* Effect.die(new Error("Missing authorization code"));
    }
    interaction.notify({
      message: "Exchanging authorization code for an API key...",
      type: "progress",
    });
    return yield* exchangeAuthorizationCode(code, verifier, interaction.signal);
  });

const loginOpenRouter = (
  interaction: typesModule.ProviderAuthInteraction,
): Promise<typesModule.OAuthCredential> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { verifier, challenge } = yield* Effect.promise(() => generatePKCE());
      const callback = yield* startOAuthCallbackServer({
        complete: (code) => exchangeAuthorizationCode(code, verifier, interaction.signal),
        host: getCallbackHost(),
        path: `/oauth/callback/${randomUuid()}`,
        port: 0,
        providerName: "OpenRouter",
        signal: interaction.signal,
        timeoutMs: LOGIN_TIMEOUT_MS,
      });

      const authorizeUrl = new URL(AUTHORIZE_URL);
      authorizeUrl.search = new URLSearchParams({
        callback_url: callback.redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();

      interaction.notify({
        message: `Listening for OpenRouter OAuth callback on ${callback.redirectUri}`,
        type: "progress",
      });
      interaction.notify({
        instructions:
          "Complete sign-in in your browser. If the browser is on another machine, paste the final redirect URL here.",
        type: "auth_url",
        url: authorizeUrl.toString(),
      });

      return yield* promptForManualCode(interaction, callback, verifier).pipe(
        Effect.ensuring(callback.close),
      );
    }),
  );

const openRouterOAuth: typesModule.OAuthAuth = {
  login: loginOpenRouter,
  loginLabel: "Sign in with OpenRouter",
  name: "OpenRouter OAuth",
  refresh(credential, _signal) {
    return Promise.resolve(credential);
  },
  toAuth(credential) {
    return Promise.resolve({ apiKey: credential.access });
  },
};

const openrouter = {
  openRouterOAuth,
};

export default openrouter;

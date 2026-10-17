import { Effect } from "effect";

import { randomUuid } from "../../utils/crypto.ts";
import { type HttpReply, httpRequest } from "../../utils/http.ts";
import { encodeJson } from "../../utils/json-codec.ts";
import { getProviderEnvValue } from "../../utils/provider-env.ts";
import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from "../types.ts";
import {
  type OAuthCallbackServer,
  startOAuthCallbackServer,
  waitForCallbackOrManualInput,
} from "./callback-server.ts";
import { generatePKCE } from "./pkce.ts";

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
): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    if (signal.aborted) return yield* Effect.die(new Error("Login cancelled"));
    const timeout = AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS);
    const reply = yield* httpRequest({
      url: TOKEN_URL,
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: yield* encodeJson({ code, code_verifier: verifier, code_challenge_method: "S256" }),
      signal: AbortSignal.any([signal, timeout]),
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

const readJsonBody = (reply: HttpReply): Effect.Effect<JsonObject> =>
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

const credentialFromBody = (reply: HttpReply, body: JsonObject): Effect.Effect<OAuthCredential> =>
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
      type: "oauth" as const,
      access: key,
      refresh: "",
      expires: Number.MAX_SAFE_INTEGER,
    };
  });

const promptForManualCode = (
  interaction: ProviderAuthInteraction,
  callback: OAuthCallbackServer<OAuthCredential>,
  verifier: string,
) =>
  Effect.gen(function* () {
    const result = yield* waitForCallbackOrManualInput({
      interaction,
      callback,
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
      type: "progress",
      message: "Exchanging authorization code for an API key...",
    });
    return yield* exchangeAuthorizationCode(code, verifier, interaction.signal);
  });

const loginOpenRouter = (interaction: ProviderAuthInteraction): Promise<OAuthCredential> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { verifier, challenge } = yield* Effect.promise(() => generatePKCE());
      const callback = yield* startOAuthCallbackServer({
        providerName: "OpenRouter",
        host: getCallbackHost(),
        port: 0,
        path: `/oauth/callback/${randomUuid()}`,
        complete: (code) => exchangeAuthorizationCode(code, verifier, interaction.signal),
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
        type: "progress",
        message: `Listening for OpenRouter OAuth callback on ${callback.redirectUri}`,
      });
      interaction.notify({
        type: "auth_url",
        url: authorizeUrl.toString(),
        instructions:
          "Complete sign-in in your browser. If the browser is on another machine, paste the final redirect URL here.",
      });

      return yield* promptForManualCode(interaction, callback, verifier).pipe(
        Effect.ensuring(callback.close),
      );
    }),
  );

export const openRouterOAuth: OAuthAuth = {
  name: "OpenRouter OAuth",
  loginLabel: "Sign in with OpenRouter",
  login: loginOpenRouter,
  refresh(credential, _signal) {
    return Promise.resolve(credential);
  },
  toAuth(credential) {
    return Promise.resolve({ apiKey: credential.access });
  },
};

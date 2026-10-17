import { Effect } from "effect";

import { randomHex } from "../../utils/crypto.ts";
import type {
  LoginOptions,
  OAuthAuth,
  OAuthCredential,
  ProviderAuthInteraction,
} from "../types.ts";
import { parseAuthorizationInput } from "./authorization-input.ts";
import {
  type OAuthCallbackServer,
  startOAuthCallbackServer,
  waitForCallbackOrManualInput,
} from "./callback-server.ts";
import { loginWithDeviceCode } from "./openai-codex-device.ts";
import {
  AUTHORIZE_URL,
  BROWSER_LOGIN_METHOD,
  CLIENT_ID,
  DEVICE_CODE_LOGIN_METHOD,
  exchangeAuthorizationCode,
  getCallbackHost,
  REDIRECT_URI,
  refreshCodexToken,
  SCOPE,
} from "./openai-codex-shared.ts";
import { generatePKCE } from "./pkce.ts";

interface AuthorizationFlow {
  readonly verifier: string;
  readonly state: string;
  readonly url: string;
}

const createAuthorizationFlow = (originator: string): Effect.Effect<AuthorizationFlow> =>
  Effect.gen(function* () {
    const { verifier, challenge } = yield* Effect.promise(() => generatePKCE());
    const state = randomHex(16);

    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("scope", SCOPE);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("id_token_add_organizations", "true");
    url.searchParams.set("codex_cli_simplified_flow", "true");
    url.searchParams.set("originator", originator);

    return { verifier, state, url: url.toString() };
  });

const openCallbackServer = (
  interaction: ProviderAuthInteraction,
  state: string,
): Effect.Effect<OAuthCallbackServer<string> | undefined> =>
  Effect.promise(() =>
    startOAuthCallbackServer({
      providerName: "OpenAI",
      host: getCallbackHost(),
      port: 1455,
      path: "/auth/callback",
      state,
      complete: (code) => Promise.resolve(code),
      signal: interaction.signal,
    }).catch(() => undefined),
  );

const readAuthorizationCode = (
  interaction: ProviderAuthInteraction,
  callback: OAuthCallbackServer<string> | undefined,
  state: string,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const result = yield* Effect.promise(() =>
      waitForCallbackOrManualInput(interaction, callback, {
        message:
          "Complete login in your browser, or paste the authorization code / redirect URL here:",
        placeholder: REDIRECT_URI,
      }),
    );
    if (result.type === "callback") return result.value;

    const parsed = parseAuthorizationInput(result.input);
    if (parsed.state !== undefined && parsed.state !== "" && parsed.state !== state) {
      return yield* Effect.die(new Error("State mismatch"));
    }
    if (parsed.code === undefined || parsed.code === "") {
      return yield* Effect.die(new Error("Missing authorization code"));
    }
    return parsed.code;
  });

const loginWithBrowser = (
  interaction: ProviderAuthInteraction,
  options?: LoginOptions,
): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    const flow = yield* createAuthorizationFlow(options?.agentName ?? "pi");
    const callback = yield* openCallbackServer(interaction, flow.state);

    interaction.notify({
      type: "auth_url",
      url: flow.url,
      instructions: "A browser window should open. Complete login to finish.",
    });

    return yield* Effect.gen(function* () {
      const code = yield* readAuthorizationCode(interaction, callback, flow.state);
      return yield* exchangeAuthorizationCode({
        code,
        verifier: flow.verifier,
        redirectUri: REDIRECT_URI,
        signal: interaction.signal,
      });
    }).pipe(Effect.ensuring(Effect.sync(() => callback?.close())));
  });

const login = (
  interaction: ProviderAuthInteraction,
  options?: LoginOptions,
): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    const method = yield* Effect.promise(() =>
      interaction.prompt({
        type: "select",
        message: "Select OpenAI Codex login method:",
        options: [
          { id: BROWSER_LOGIN_METHOD, label: "Browser login (default)" },
          { id: DEVICE_CODE_LOGIN_METHOD, label: "Device code login (headless)" },
        ],
      }),
    );

    if (method === DEVICE_CODE_LOGIN_METHOD) return yield* loginWithDeviceCode(interaction);
    if (method !== BROWSER_LOGIN_METHOD) {
      return yield* Effect.die(new Error(`Unknown OpenAI Codex login method: ${method}`));
    }
    return yield* loginWithBrowser(interaction, options);
  });

export const openaiCodexOAuth: OAuthAuth = {
  name: "OpenAI (ChatGPT Plus/Pro)",
  isSubscription: true,

  login: (interaction, options) => Effect.runPromise(login(interaction, options)),

  refresh: (credential, signal) =>
    Effect.runPromise(refreshCodexToken({ refreshToken: credential.refresh, signal })),

  toAuth(credential) {
    return Promise.resolve({ apiKey: credential.access });
  },
};

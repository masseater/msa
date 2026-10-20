import { Effect, Option } from "effect";

import cryptoModule from "../../utils/crypto.ts";
import type typesModule from "../types.ts";
import authorizationInput from "./authorization-input.ts";
import callbackServer from "./callback-server.ts";
import type callbackServerTypes from "./callback-server.types.ts";
import openaiCodexDevice from "./openai-codex-device.ts";
import openaiCodexShared from "./openai-codex-shared.ts";
import pkce from "./pkce.ts";

const { generatePKCE } = pkce;
const { randomHex } = cryptoModule;
const {
  AUTHORIZE_URL,
  BROWSER_LOGIN_METHOD,
  CLIENT_ID,
  DEVICE_CODE_LOGIN_METHOD,
  REDIRECT_URI,
  SCOPE,
  exchangeAuthorizationCode,
  getCallbackHost,
  refreshCodexToken,
} = openaiCodexShared;
const { startOAuthCallbackServer, waitForCallbackOrManualInput } = callbackServer;
const { parseAuthorizationInput } = authorizationInput;
const { loginWithDeviceCode } = openaiCodexDevice;

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

    return { state, url: url.toString(), verifier };
  });

const openCallbackServer = (
  interaction: typesModule.ProviderAuthInteraction,
  state: string,
): Effect.Effect<callbackServerTypes.OAuthCallbackServer<string> | undefined> =>
  startOAuthCallbackServer({
    complete: (code) => Effect.succeed(code),
    host: getCallbackHost(),
    path: "/auth/callback",
    port: 1455,
    providerName: "OpenAI",
    signal: interaction.signal,
    state,
  }).pipe(
    Effect.asSome,
    Effect.catchDefect(() => Effect.succeedNone),
    Effect.map(Option.getOrUndefined),
  );

const readAuthorizationCode = (
  interaction: typesModule.ProviderAuthInteraction,
  callback: callbackServerTypes.OAuthCallbackServer<string> | undefined,
  state: string,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const result = yield* waitForCallbackOrManualInput({
      callback,
      interaction,
      message:
        "Complete login in your browser, or paste the authorization code / redirect URL here:",
      placeholder: REDIRECT_URI,
    });
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
  interaction: typesModule.ProviderAuthInteraction,
  options?: typesModule.LoginOptions,
): Effect.Effect<typesModule.OAuthCredential> =>
  Effect.gen(function* () {
    const flow = yield* createAuthorizationFlow(options?.agentName ?? "pi");
    const callback = yield* openCallbackServer(interaction, flow.state);

    interaction.notify({
      instructions: "A browser window should open. Complete login to finish.",
      type: "auth_url",
      url: flow.url,
    });

    return yield* Effect.gen(function* () {
      const code = yield* readAuthorizationCode(interaction, callback, flow.state);
      return yield* exchangeAuthorizationCode({
        code,
        redirectUri: REDIRECT_URI,
        signal: interaction.signal,
        verifier: flow.verifier,
      });
    }).pipe(Effect.ensuring(callback === undefined ? Effect.void : callback.close));
  });

const login = (
  interaction: typesModule.ProviderAuthInteraction,
  options?: typesModule.LoginOptions,
): Effect.Effect<typesModule.OAuthCredential> =>
  Effect.gen(function* () {
    const method = yield* Effect.promise(() =>
      interaction.prompt({
        message: "Select OpenAI Codex login method:",
        options: [
          { id: BROWSER_LOGIN_METHOD, label: "Browser login (default)" },
          { id: DEVICE_CODE_LOGIN_METHOD, label: "Device code login (headless)" },
        ],
        type: "select",
      }),
    );

    if (method === DEVICE_CODE_LOGIN_METHOD) return yield* loginWithDeviceCode(interaction);
    if (method !== BROWSER_LOGIN_METHOD) {
      return yield* Effect.die(new Error(`Unknown OpenAI Codex login method: ${method}`));
    }
    return yield* loginWithBrowser(interaction, options);
  });

const openaiCodexOAuth: typesModule.OAuthAuth = {
  isSubscription: true,
  login: (interaction, options) => Effect.runPromise(login(interaction, options)),
  name: "OpenAI (ChatGPT Plus/Pro)",
  refresh: (credential, signal) =>
    Effect.runPromise(refreshCodexToken({ refreshToken: credential.refresh, signal })),
  toAuth(credential) {
    return Promise.resolve({ apiKey: credential.access });
  },
};

const openaiCodex = {
  openaiCodexOAuth,
};

export default openaiCodex;

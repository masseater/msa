import { Effect } from "effect";

import { normalizeRadiusGatewayUrl } from "../../providers/radius-config.ts";
import { randomUuid } from "../../utils/crypto.ts";
import { httpRequest } from "../../utils/http.ts";
import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from "../types.ts";
import { startOAuthCallbackServer } from "./callback-server.ts";
import { generatePKCE } from "./pkce.ts";
import { loginWithDeviceCode } from "./radius-device.ts";
import {
  CALLBACK_HOST,
  CALLBACK_PATH,
  CALLBACK_PORT,
  OAUTH_CLIENT_ID,
  OAUTH_SCOPE,
  REDIRECT_URI,
} from "./radius-shared.ts";
import { requestOAuthToken } from "./radius-token.ts";

const LOGIN_METHOD_BROWSER = "browser";
const LOGIN_METHOD_DEVICE_CODE = "device-code";

type RadiusOAuthDiscovery = {
  authorizationEndpoint: string;
};

const loadRadiusOAuthDiscovery = (
  gateway: string,
  signal: AbortSignal,
): Effect.Effect<RadiusOAuthDiscovery> =>
  Effect.gen(function* () {
    const reply = yield* httpRequest({
      url: new URL("/v1/oauth", gateway),
      headers: { accept: "application/json" },
      signal,
    });

    if (!reply.ok) {
      const text = yield* reply.text;
      return yield* Effect.die(
        new Error(`Could not load Radius OAuth config from ${gateway}: ${reply.status} ${text}`),
      );
    }

    const discovery = (yield* reply.json) as Partial<RadiusOAuthDiscovery>;
    if (typeof discovery.authorizationEndpoint !== "string") {
      return yield* Effect.die(new Error(`Invalid Radius OAuth config from ${gateway}`));
    }
    return { authorizationEndpoint: discovery.authorizationEndpoint };
  });

const browserAuthorizeUrl = (
  authorizationEndpoint: string,
  challenge: string,
  state: string,
): URL => {
  const authorizeUrl = new URL(authorizationEndpoint);
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: OAUTH_SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    handoff: "url",
    state,
  }).toString();
  return authorizeUrl;
};

interface BrowserLogin {
  readonly gateway: string;
  readonly authorizationEndpoint: string;
  readonly interaction: ProviderAuthInteraction;
}

const startBrowserCallbackServer = (
  { gateway, interaction }: BrowserLogin,
  state: string,
  verifier: string,
) =>
  startOAuthCallbackServer({
    providerName: "Radius",
    host: CALLBACK_HOST,
    port: CALLBACK_PORT,
    path: CALLBACK_PATH,
    state,
    complete: (code) =>
      requestOAuthToken({
        gateway,
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: OAUTH_CLIENT_ID,
          redirect_uri: REDIRECT_URI,
          code,
          code_verifier: verifier,
        }),
        signal: interaction.signal,
      }).pipe(Effect.catchTag("RadiusOAuthResponseError", Effect.die)),
    signal: interaction.signal,
  });

const loginWithBrowser = (login: BrowserLogin): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    const { interaction } = login;
    const { verifier, challenge } = yield* Effect.promise(() => generatePKCE());
    const state = randomUuid();
    const authorizeUrl = browserAuthorizeUrl(login.authorizationEndpoint, challenge, state);
    const callback = yield* startBrowserCallbackServer(login, state, verifier);

    interaction.notify({
      type: "progress",
      message: `Listening for OAuth callback on ${REDIRECT_URI}`,
    });
    interaction.notify({
      type: "auth_url",
      url: authorizeUrl.toString(),
      instructions: "Continue in your browser.",
    });

    return yield* Effect.gen(function* () {
      const credential = yield* callback.wait;
      if (credential === undefined) {
        return yield* Effect.die(new Error("OAuth callback did not complete."));
      }
      return credential;
    }).pipe(Effect.ensuring(callback.close));
  });

export interface RadiusOAuthOptions {
  name: string;
  gateway: string;
}

const promptLoginMethod = (interaction: ProviderAuthInteraction, name: string) =>
  Effect.promise(() =>
    interaction.prompt({
      type: "select",
      message: `Sign in to ${name}:`,
      options: [
        { id: LOGIN_METHOD_BROWSER, label: "Sign in with browser (recommended)" },
        {
          id: LOGIN_METHOD_DEVICE_CODE,
          label: "Sign in with device code (when signing in from another device)",
        },
      ],
    }),
  );

const loginRadius = (
  options: RadiusOAuthOptions,
  gateway: string,
  interaction: ProviderAuthInteraction,
): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    const loginMethod = yield* promptLoginMethod(interaction, options.name);
    if (loginMethod === LOGIN_METHOD_DEVICE_CODE) {
      return yield* loginWithDeviceCode({ gateway, interaction });
    }
    if (loginMethod === LOGIN_METHOD_BROWSER) {
      const discovery = yield* loadRadiusOAuthDiscovery(gateway, interaction.signal);
      return yield* loginWithBrowser({
        gateway,
        authorizationEndpoint: discovery.authorizationEndpoint,
        interaction,
      });
    }
    return yield* Effect.die(new Error(`Unknown ${options.name} sign-in method: ${loginMethod}`));
  });

export const createRadiusOAuth = (options: RadiusOAuthOptions): OAuthAuth => {
  const gateway = normalizeRadiusGatewayUrl(options.gateway);

  return {
    name: options.name,

    login: (interaction) => Effect.runPromise(loginRadius(options, gateway, interaction)),

    refresh: (credential, signal) =>
      Effect.runPromise(
        requestOAuthToken({
          gateway,
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: OAUTH_CLIENT_ID,
            refresh_token: credential.refresh,
          }),
          signal,
        }).pipe(Effect.catchTag("RadiusOAuthResponseError", Effect.die)),
      ),

    toAuth(credential) {
      return Promise.resolve({ apiKey: credential.access });
    },
  };
};

import { Effect } from "effect";

import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from "../types.ts";
import {
  authorizeUrl,
  BROWSER_LOGIN_METHOD,
  CALLBACK_HOST,
  CALLBACK_PATH,
  CALLBACK_PORT,
  COPY_CODE_LOGIN_METHOD,
  COPY_CODE_REDIRECT_URI,
  exchangeAuthorizationCode,
  REDIRECT_URI,
  refreshAnthropicToken,
} from "./anthropic-shared.ts";
import { parseAuthorizationInput } from "./authorization-input.ts";
import {
  type OAuthCallbackServer,
  startOAuthCallbackServer,
  waitForCallbackOrManualInput,
} from "./callback-server.ts";
import { generatePKCE } from "./pkce.ts";

const startCallbackServer = (
  interaction: ProviderAuthInteraction,
  verifier: string,
  port: number,
): Promise<OAuthCallbackServer<string>> =>
  startOAuthCallbackServer({
    providerName: "Anthropic",
    host: CALLBACK_HOST,
    port,
    path: CALLBACK_PATH,
    redirectHost: "localhost",
    state: verifier,
    complete: (code) => Promise.resolve(code),
    signal: interaction.signal,
  });

const openCallbackServer = (
  interaction: ProviderAuthInteraction,
  verifier: string,
): Effect.Effect<OAuthCallbackServer<string> | undefined> =>
  Effect.promise(() =>
    startCallbackServer(interaction, verifier, CALLBACK_PORT)
      .catch(() => startCallbackServer(interaction, verifier, 0))
      .catch(() => undefined),
  );

interface AuthorizationCode {
  readonly code: string;
  readonly state: string;
}

const readAuthorizationCode = (
  interaction: ProviderAuthInteraction,
  callback: OAuthCallbackServer<string> | undefined,
  verifier: string,
  redirectUri: string,
): Effect.Effect<AuthorizationCode> =>
  Effect.gen(function* () {
    const result = yield* Effect.promise(() =>
      waitForCallbackOrManualInput(interaction, callback, {
        message:
          "Complete login in your browser, or paste the authorization code / redirect URL here:",
        placeholder: redirectUri,
      }),
    );
    if (result.type === "callback") {
      return { code: result.value, state: verifier };
    }
    const parsed = parseAuthorizationInput(result.input);
    if (parsed.state !== undefined && parsed.state !== "" && parsed.state !== verifier) {
      return yield* Effect.die(new Error("OAuth state mismatch"));
    }
    if (parsed.code === undefined || parsed.code === "") {
      return yield* Effect.die(new Error("Missing authorization code"));
    }
    return { code: parsed.code, state: parsed.state ?? verifier };
  });

const loginAnthropic = (interaction: ProviderAuthInteraction): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    const { verifier, challenge } = yield* Effect.promise(() => generatePKCE());
    const callback = yield* openCallbackServer(interaction, verifier);
    const redirectUri = callback?.redirectUri ?? REDIRECT_URI;

    return yield* Effect.gen(function* () {
      interaction.notify({
        type: "auth_url",
        url: authorizeUrl({ redirectUri, challenge, verifier }),
        instructions:
          "Complete login in your browser. If the browser is on another machine, paste the final redirect URL here.",
      });

      const { code, state } = yield* readAuthorizationCode(
        interaction,
        callback,
        verifier,
        redirectUri,
      );
      interaction.notify({
        type: "progress",
        message: "Exchanging authorization code for tokens...",
      });
      return yield* exchangeAuthorizationCode({
        code,
        state,
        verifier,
        redirectUri,
        signal: interaction.signal,
      });
    }).pipe(Effect.ensuring(Effect.sync(() => callback?.close())));
  });

const loginAnthropicCopyCode = (
  interaction: ProviderAuthInteraction,
): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    const { verifier, challenge } = yield* Effect.promise(() => generatePKCE());
    interaction.notify({
      type: "auth_url",
      url: authorizeUrl({ redirectUri: COPY_CODE_REDIRECT_URI, challenge, verifier }),
      instructions:
        "Complete login in your browser, then copy the code Anthropic shows and paste it here.",
    });

    const input = yield* Effect.promise(() =>
      interaction.prompt({
        type: "manual_code",
        message: "Paste the code Anthropic shows after you sign in:",
        placeholder: "code#state",
        signal: interaction.signal,
      }),
    );
    const parsed = parseAuthorizationInput(input);
    if (parsed.state !== undefined && parsed.state !== "" && parsed.state !== verifier) {
      return yield* Effect.die(new Error("OAuth state mismatch"));
    }
    if (parsed.code === undefined || parsed.code === "") {
      return yield* Effect.die(new Error("Missing authorization code"));
    }
    interaction.notify({
      type: "progress",
      message: "Exchanging authorization code for tokens...",
    });
    return yield* exchangeAuthorizationCode({
      code: parsed.code,
      state: parsed.state ?? verifier,
      verifier,
      redirectUri: COPY_CODE_REDIRECT_URI,
      signal: interaction.signal,
    });
  });

const login = (interaction: ProviderAuthInteraction): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    const method = yield* Effect.promise(() =>
      interaction.prompt({
        type: "select",
        message: "Select Anthropic login method:",
        options: [
          { id: BROWSER_LOGIN_METHOD, label: "Browser login (default)" },
          { id: COPY_CODE_LOGIN_METHOD, label: "Copy code login (headless)" },
        ],
      }),
    );

    if (method === COPY_CODE_LOGIN_METHOD) return yield* loginAnthropicCopyCode(interaction);
    if (method !== BROWSER_LOGIN_METHOD) {
      return yield* Effect.die(new Error(`Unknown Anthropic login method: ${method}`));
    }
    return yield* loginAnthropic(interaction);
  });

export const anthropicOAuth: OAuthAuth = {
  name: "Anthropic (Claude Pro/Max)",
  isSubscription: true,

  login: (interaction) => Effect.runPromise(login(interaction)),

  refresh: (credential, signal) =>
    Effect.runPromise(refreshAnthropicToken({ refreshToken: credential.refresh, signal })),

  toAuth(credential) {
    return Promise.resolve({ apiKey: credential.access });
  },
};

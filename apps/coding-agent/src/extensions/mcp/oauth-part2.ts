import mcp from "@msa/mcp";
import type mcpTypes from "@msa/mcp/index.types";
import oauth from "@msa/mcp/oauth";
import type oauthTypes from "@msa/mcp/oauth.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import platform from "../../core/platform.ts";
import oauthPart1 from "./oauth-part1.ts";
import type oauthTypesNs from "./oauth.types.ts";

const { awaited, awaiting } = awaitingModule;
const { McpOAuthAuthorizationRequiredError, authorizeMcp, parseWwwAuthenticate } = oauth;
const { toPromise } = mcp;
const { nowMs } = platform;
const {
  FALLBACK_REDIRECT_URL,
  REFRESH_SKEW_MS,
  callbackSettings,
  createProvider,
  registeredRedirectUrls,
  timedFetch,
} = oauthPart1;

function createMcpAuthProvider(options: {
  serverUrl: string;
  store: oauthTypesNs.McpOAuthServerStore;
  settings: () => oauthTypesNs.McpOAuthSettings;
  onChallenge: (challenge: oauthTypes.OAuthChallenge) => void;
}): oauthTypesNs.McpAuthProvider {
  const { serverUrl, store } = options;
  let refreshing: Promise<void> | undefined;

  const refresh = createMcpAuthProviderPart1();

  return {
    onUnauthorized: (context) =>
      Effect.runPromise(
        awaiting(function* () {
          const challenge = parseWwwAuthenticate(context.response.headers.get("www-authenticate"));
          options.onChallenge(challenge);

          if (challenge.error === "insufficient_scope")
            throw new McpOAuthAuthorizationRequiredError();
          yield* awaited(refresh(context.token, context.fetch, challenge));
        }),
      ),
    settled: () =>
      Effect.runPromise(
        awaiting(function* () {
          yield* awaited(refreshing?.catch(() => undefined));
        }),
      ),
    token: () =>
      Effect.runPromise(
        awaiting(function* () {
          yield* awaited(refreshing?.catch(() => undefined));
          const state = yield* awaited(store.load());
          const token = state?.tokens?.access_token;
          const expired =
            state?.tokensExpireAt !== undefined &&
            state.tokensExpireAt - REFRESH_SKEW_MS <= nowMs();
          if (
            !expired ||
            state?.tokens?.refresh_token === undefined ||
            state?.tokens?.refresh_token === ""
          )
            return token;

          yield* awaited(refresh(token).catch(() => undefined));
          return (yield* awaited(store.load()))?.tokens?.access_token;
        }),
      ),
  };

  function createMcpAuthProviderPart1() {
    return createMcpAuthProviderPart2();
  }

  function createMcpAuthProviderPart2() {
    return createMcpAuthProviderPart3();
  }

  function createMcpAuthProviderPart3() {
    return createMcpAuthProviderPart4();
  }

  function createMcpAuthProviderPart4() {
    return createMcpAuthProviderPart5();
  }

  function createMcpAuthProviderPart5() {
    return createMcpAuthProviderPart6();
  }

  function createMcpAuthProviderPart6() {
    return createMcpAuthProviderPart7();
  }

  function createMcpAuthProviderPart7() {
    return createMcpAuthProviderPart8();
  }

  function createMcpAuthProviderPart8() {
    return (
      staleToken: string | undefined,
      fetch: mcpTypes.McpFetch = globalThis.fetch,
      challenge?: oauthTypes.OAuthChallenge,
    ) => {
      refreshing ??= store
        .withRefreshLock(() =>
          Effect.runPromise(
            awaiting(function* () {
              const state = yield* awaited(store.load());
              if (state?.tokens?.access_token !== staleToken) return;
              if (state?.tokens?.refresh_token === undefined || state?.tokens?.refresh_token === "")
                throw new McpOAuthAuthorizationRequiredError();
              const settings = options.settings();
              const redirectUrl =
                callbackSettings(settings).fixedRedirectUrl ??
                registeredRedirectUrls(state.clientInformation)[0] ??
                FALLBACK_REDIRECT_URL;
              const provider = createProvider(serverUrl, store, settings, redirectUrl, () => {});

              const resourceMetadataUrl = challenge?.resourceMetadataUrl;
              const authorizationServerMetadataUrl = settings.authServerMetadataUrl;
              const scope = challenge?.scope;
              const result = yield* awaited(
                authorizeMcp(provider, {
                  serverUrl,
                  ...(resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl }),
                  ...(authorizationServerMetadataUrl === undefined
                    ? {}
                    : { authorizationServerMetadataUrl }),
                  ...(scope === undefined ? {} : { scope }),
                  fetch: timedFetch(fetch),
                }).pipe(toPromise),
              );
              if (result === "REDIRECT") throw new McpOAuthAuthorizationRequiredError();
            }),
          ),
        )
        .finally(() => {
          refreshing = undefined;
        });
      return refreshing;
    };
  }
}

const oauthPart2 = {
  createMcpAuthProvider,
};

export default oauthPart2;

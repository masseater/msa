import mcp from "@msa/mcp";
import type mcpTypes from "@msa/mcp/index.types";
import oauth from "@msa/mcp/oauth";
import type oauthTypes from "@msa/mcp/oauth.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import platform from "../../../core/platform/index.ts";
import type oauthTypesNs from "../oauth.types.ts";
import oauthClient from "./oauth-client.ts";

const { awaited, awaitingWith } = awaitingModule;
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
} = oauthClient;

type UnauthorizedContext = Parameters<NonNullable<mcpTypes.AuthProvider["onUnauthorized"]>>[0];

type AuthProviderOptions = {
  serverUrl: string;
  store: oauthTypesNs.McpOAuthServerStore;
  settings: () => oauthTypesNs.McpOAuthSettings;
  onChallenge: (challenge: oauthTypes.OAuthChallenge) => void;
};

export default class McpTokenRefresh implements oauthTypesNs.McpAuthProvider {
  private readonly options: AuthProviderOptions;

  private refreshing: Promise<void> | undefined;

  constructor(options: AuthProviderOptions) {
    this.options = options;
  }

  readonly onUnauthorized = (context: UnauthorizedContext): Promise<void> =>
    Effect.runPromise(
      awaitingWith(function* () {
        const challenge = parseWwwAuthenticate(context.response.headers.get("www-authenticate"));
        this.options.onChallenge(challenge);
        if (challenge.error === "insufficient_scope") {
          throw new McpOAuthAuthorizationRequiredError();
        }
        yield* awaited(this.refresh(context.token, context.fetch, challenge));
      }, this),
    );

  readonly settled = (): Promise<void> =>
    Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.refreshing?.catch(() => undefined));
      }, this),
    );

  readonly token = (): Promise<string | undefined> =>
    Effect.runPromise(
      awaitingWith(function* () {
        const { store } = this.options;
        yield* awaited(this.refreshing?.catch(() => undefined));
        const state = yield* awaited(store.load());
        const token = state?.tokens?.access_token;
        const expired =
          state?.tokensExpireAt !== undefined && state.tokensExpireAt - REFRESH_SKEW_MS <= nowMs();
        const refreshToken = state?.tokens?.refresh_token;
        if (!expired || refreshToken === undefined || refreshToken === "") return token;
        yield* awaited(this.refresh(token).catch(() => undefined));
        return (yield* awaited(store.load()))?.tokens?.access_token;
      }, this),
    );

  private refresh(
    staleToken: string | undefined,
    fetch: mcpTypes.McpFetch = globalThis.fetch,
    challenge?: oauthTypes.OAuthChallenge,
  ): Promise<void> {
    this.refreshing ??= this.options.store
      .withRefreshLock(() => this.reauthorize(staleToken, fetch, challenge))
      .finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }

  private reauthorize(
    staleToken: string | undefined,
    fetch: mcpTypes.McpFetch,
    challenge: oauthTypes.OAuthChallenge | undefined,
  ): Promise<void> {
    const { serverUrl, store } = this.options;
    return Effect.runPromise(
      awaitingWith(function* () {
        const state = yield* awaited(store.load());
        if (state?.tokens?.access_token !== staleToken) return;
        if (state?.tokens?.refresh_token === undefined || state.tokens.refresh_token === "") {
          throw new McpOAuthAuthorizationRequiredError();
        }
        const settings = this.options.settings();
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
      }, this),
    );
  }
}

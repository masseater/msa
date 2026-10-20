import mcp from "@msa/mcp";
import oauth from "@msa/mcp/oauth";
import type oauthTypes from "@msa/mcp/oauth.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import oauthPart1 from "./oauth-part1.ts";
import oauthPart3 from "./oauth-part3.ts";
import type oauthTypesNs from "./oauth.types.ts";
import McpSignInCancelledError from "./sign-in-cancelled.ts";

const { awaited, awaiting } = awaitingModule;
const { authorizeMcp, stepUpScope } = oauth;
const { toPromise } = mcp;
const {
  CALLBACK_PATH,
  callbackId,
  callbackSettings,
  createProvider,
  mergeScopes,
  registeredRedirectUrls,
  timedFetch,
} = oauthPart1;
const { listenForCallback, waitForAuthorizationResponse } = oauthPart3;

function signInMcpServer(options: {
  serverUrl: string;
  store: oauthTypes.McpOAuthStateStore;
  settings: oauthTypesNs.McpOAuthSettings;
  challenge?: oauthTypes.OAuthChallenge | undefined;
  prompt: oauthTypesNs.McpSignInPrompt;
  signal?: AbortSignal | undefined;
}): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      const { serverUrl, store, settings, signal } = options;
      if (signal?.aborted === true) throw new McpSignInCancelledError();
      const stored = yield* awaited(store.load());
      const stepUp = options.challenge?.error === "insufficient_scope";
      const callbackOptions = callbackSettings(settings);

      const registered = registeredRedirectUrls(stored?.clientInformation)[0];
      const registeredPort =
        registered !== undefined && registered !== "" ? Number(new URL(registered).port) : 0;
      const preferredPort =
        callbackOptions.port ?? (registeredPort > 0 ? registeredPort : undefined);
      const cimd = settings.clientRegistration === "cimd";
      const callback = yield* awaited(
        listenForCallback(
          callbackOptions,

          cimd ? [`${CALLBACK_PATH}/${callbackId(serverUrl)}`] : [],
          preferredPort,
          callbackOptions.port !== undefined,
        ),
      );
      const redirectUrl = callbackOptions.fixedRedirectUrl ?? callback.redirectUrl;
      try {
        if (stored !== undefined) {
          const next: oauthTypes.McpOAuthState = { ...stored };

          delete next.oauthState;

          const keepClient =
            settings.clientId ||
            (cimd
              ? stored.clientInformation === undefined
              : registeredRedirectUrls(stored.clientInformation).includes(redirectUrl));
          if (keepClient === false || keepClient === "") {
            delete next.clientInformation;
            delete next.tokens;
            delete next.tokensExpireAt;
          }
          yield* awaited(store.save(next));
        }

        let authorizationUrl: URL | undefined;
        const provider = createProvider(serverUrl, store, settings, redirectUrl, (url) => {
          authorizationUrl = url;
        });
        const resourceMetadataUrl = options.challenge?.resourceMetadataUrl;
        const authorizationServerMetadataUrl = settings.authServerMetadataUrl;

        const scope = mergeScopes(
          settings.scope,
          stepUp
            ? stepUpScope(stored?.tokens?.scope, options.challenge?.scope)
            : options.challenge?.scope,
        );
        const flow = {
          fetch: timedFetch(),
          serverUrl,
          ...(signal === undefined ? {} : { signal }),
          ...(resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl }),
          ...(authorizationServerMetadataUrl === undefined
            ? {}
            : { authorizationServerMetadataUrl }),
          ...(scope === undefined ? {} : { scope }),
        };

        const skipRefresh = stepUp;
        if (
          (yield* awaited(authorizeMcp(provider, { ...flow, skipRefresh }).pipe(toPromise))) ===
          "AUTHORIZED"
        )
          return;
        if (authorizationUrl === undefined)
          throw new Error("OAuth flow did not produce an authorization URL");

        const state = yield* awaited(provider.state());

        const authorizationRedirectUrl = new URL(
          authorizationUrl.searchParams.get("redirect_uri") ?? redirectUrl,
        );
        options.prompt.showAuthorizationUrl(authorizationUrl);
        const { code, iss } = yield* awaited(
          waitForAuthorizationResponse(
            callback,
            state,
            authorizationRedirectUrl,
            options.prompt,
            signal,
          ),
        );
        yield* awaited(
          authorizeMcp(provider, {
            ...flow,
            authorizationCode: code,
            ...(iss === undefined ? {} : { iss }),
          }).pipe(toPromise),
        );
      } catch (error) {
        if (signal?.aborted ?? false) throw new McpSignInCancelledError();
        throw error;
      } finally {
        yield* awaited(callback.close());
      }
    }),
  );
}

const oauthPart4 = {
  signInMcpServer,
};

export default oauthPart4;

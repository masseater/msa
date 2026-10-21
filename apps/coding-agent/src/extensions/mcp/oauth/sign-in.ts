import mcp from "@msa/mcp";
import oauth from "@msa/mcp/oauth";
import type oauthTypes from "@msa/mcp/oauth.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import type oauthTypesNs from "../oauth.types.ts";
import McpSignInCancelledError from "../sign-in-cancelled.ts";
import oauthCallback from "./oauth-callback.ts";
import oauthClient from "./oauth-client.ts";

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
} = oauthClient;
const { listenForCallback, waitForAuthorizationResponse } = oauthCallback;

type SignInOptions = {
  serverUrl: string;
  store: oauthTypes.McpOAuthStateStore;
  settings: oauthTypesNs.McpOAuthSettings;
  challenge?: oauthTypes.OAuthChallenge | undefined;
  prompt: oauthTypesNs.McpSignInPrompt;
  signal?: AbortSignal | undefined;
};

type Callback = Awaited<ReturnType<typeof listenForCallback>>;

type SignInContext = {
  options: SignInOptions;
  stored: oauthTypes.McpOAuthState | undefined;
  callback: Callback;
  redirectUrl: string;
  cimd: boolean;
};

function openCallback(
  options: SignInOptions,
  stored: oauthTypes.McpOAuthState | undefined,
): Promise<SignInContext> {
  return Effect.runPromise(
    awaiting(function* () {
      const callbackOptions = callbackSettings(options.settings);
      const registered = registeredRedirectUrls(stored?.clientInformation)[0];
      const registeredPort =
        registered !== undefined && registered !== "" ? Number(new URL(registered).port) : 0;
      const preferredPort =
        callbackOptions.port ?? (registeredPort > 0 ? registeredPort : undefined);
      const cimd = options.settings.clientRegistration === "cimd";
      const callback = yield* awaited(
        listenForCallback(
          callbackOptions,
          cimd ? [`${CALLBACK_PATH}/${callbackId(options.serverUrl)}`] : [],
          preferredPort,
          callbackOptions.port !== undefined,
        ),
      );
      const redirectUrl = callbackOptions.fixedRedirectUrl ?? callback.redirectUrl;
      return { callback, cimd, options, redirectUrl, stored };
    }),
  );
}

function resetStaleClient(context: SignInContext): Promise<void> {
  const { options, stored, cimd, redirectUrl } = context;
  if (stored === undefined) return Promise.resolve();
  const next: oauthTypes.McpOAuthState = { ...stored };
  delete next.oauthState;
  const keepClient =
    options.settings.clientId ||
    (cimd
      ? stored.clientInformation === undefined
      : registeredRedirectUrls(stored.clientInformation).includes(redirectUrl));
  if (keepClient === false || keepClient === "") {
    delete next.clientInformation;
    delete next.tokens;
    delete next.tokensExpireAt;
  }
  return Promise.resolve(options.store.save(next));
}

function authorizationFlow(context: SignInContext) {
  const { options, stored } = context;
  const { serverUrl, settings, signal } = options;
  const stepUp = options.challenge?.error === "insufficient_scope";
  const resourceMetadataUrl = options.challenge?.resourceMetadataUrl;
  const authorizationServerMetadataUrl = settings.authServerMetadataUrl;
  const scope = mergeScopes(
    settings.scope,
    stepUp
      ? stepUpScope(stored?.tokens?.scope, options.challenge?.scope)
      : options.challenge?.scope,
  );
  return {
    flow: {
      fetch: timedFetch(),
      serverUrl,
      ...(signal === undefined ? {} : { signal }),
      ...(resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl }),
      ...(authorizationServerMetadataUrl === undefined ? {} : { authorizationServerMetadataUrl }),
      ...(scope === undefined ? {} : { scope }),
    },
    skipRefresh: stepUp,
  };
}

function authorize(context: SignInContext): Promise<void> {
  const { options, callback, redirectUrl } = context;
  return Effect.runPromise(
    awaiting(function* () {
      let authorizationUrl: URL | undefined;
      const provider = createProvider(
        options.serverUrl,
        options.store,
        options.settings,
        redirectUrl,
        (url) => {
          authorizationUrl = url;
        },
      );
      const { flow, skipRefresh } = authorizationFlow(context);
      const first = yield* awaited(
        authorizeMcp(provider, { ...flow, skipRefresh }).pipe(toPromise),
      );
      if (first === "AUTHORIZED") return;
      if (authorizationUrl === undefined) {
        throw new Error("OAuth flow did not produce an authorization URL");
      }
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
          options.signal,
        ),
      );
      yield* awaited(
        authorizeMcp(provider, {
          ...flow,
          authorizationCode: code,
          ...(iss === undefined ? {} : { iss }),
        }).pipe(toPromise),
      );
    }),
  );
}

function signInMcpServer(options: SignInOptions): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      const { signal } = options;
      if (signal?.aborted === true) throw new McpSignInCancelledError();
      const stored = yield* awaited(options.store.load());
      const context = yield* awaited(openCallback(options, stored));
      try {
        yield* awaited(resetStaleClient(context));
        yield* awaited(authorize(context));
      } catch (error) {
        if (signal?.aborted ?? false) throw new McpSignInCancelledError();
        throw error;
      } finally {
        yield* awaited(context.callback.close());
      }
    }),
  );
}

const signIn = { signInMcpServer };

export default signIn;

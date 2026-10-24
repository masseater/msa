import { Effect, Schema } from "effect";
import { dual } from "effect/Function";

import discoverModule from "./discover.ts";
import endpoint from "./endpoint.ts";
import errors from "./errors.ts";
import flowKit from "./flow-kit.ts";
import type flowTypesModule from "./flow-types.ts";
import type flowTypes from "./flow.types.ts";
import token from "./token.ts";
import type typesModule from "./types.types.ts";

const { authorization: authorizationModule, foreign: foreignModule } = flowKit;

const { present } = endpoint;
const { fromPromise } = foreignModule;
const { OAuthError, OAuthFlowError, OAuthInsecureEndpointError, OAuthIssuerMismatchError } = errors;
const { registerClient, startAuthorization } = authorizationModule;
const { exchangeAuthorizationCode, refreshAuthorization } = token;
const { discover } = discoverModule;

interface FlowContext {
  provider: flowTypesModule.OAuthClientProvider;
  options: flowTypesModule.OAuthFlowOptions;
  discovered: typesModule.OAuthServerInfo;
  metadata: typesModule.AuthorizationServerMetadata | undefined;
  scope: string | undefined;
}

function withScope(
  tokens: typesModule.OAuthTokens,
  scope: string | undefined,
): typesModule.OAuthTokens {
  return tokens.scope === undefined && present(scope) ? { ...tokens, scope } : tokens;
}

const stepUpScope: {
  (challenged: string | undefined): (granted: string | undefined) => string | undefined;
  (granted: string | undefined, challenged: string | undefined): string | undefined;
} = dual(2, (granted: string | undefined, challenged: string | undefined) => {
  if (!present(challenged)) return undefined;
  const scopes = [granted, challenged].flatMap(
    (scope) => scope?.split(/\s+/u).filter((item) => item !== "") ?? [],
  );
  return [...new Set(scopes)].join(" ");
});

const resolveClient = Effect.fn("resolveClient")(function* (context: FlowContext) {
  const { provider, options, discovered, metadata, scope } = context;
  const stored = yield* fromPromise(() => provider.clientInformation());
  const clientDocument: flowTypesModule.OAuthClientMetadataDocument | undefined =
    stored === undefined ? provider.clientMetadataDocument?.(metadata) : undefined;
  if (clientDocument !== undefined) {
    const url = new URL(clientDocument.url);
    if (url.protocol !== "https:" || url.pathname === "/")
      return yield* OAuthFlowError.create("Invalid OAuth client metadata URL");
  }
  const known: typesModule.OAuthClientInformationMixed | undefined =
    stored ?? (clientDocument === undefined ? undefined : { client_id: clientDocument.url });
  if (known !== undefined) return { client: known, clientDocument };
  if (present(options.authorizationCode))
    return yield* OAuthFlowError.create("OAuth client information is missing during code exchange");
  const saveClientInformation = provider.saveClientInformation?.bind(provider);
  if (saveClientInformation === undefined)
    return yield* OAuthFlowError.create("OAuth client information cannot be persisted");
  const registered = yield* registerClient(discovered.authorizationServerUrl, {
    clientMetadata: provider.clientMetadata,
    fetch: options.fetch,
    metadata,
    scope,
    signal: options.signal,
  });
  yield* fromPromise(() => saveClientInformation(registered));
  return { client: registered, clientDocument };
});

const exchangeCode = Effect.fn("exchangeCode")(function* (
  context: FlowContext,
  code: string,
  tokenOptions: flowTypesModule.TokenRequestOptions,
  redirectUrl: string | URL,
) {
  const { provider, options, discovered, metadata, scope } = context;
  const iss = options.iss;
  if (
    (iss !== undefined || metadata?.authorization_response_iss_parameter_supported === true) &&
    iss !== metadata?.issuer
  ) {
    return yield* OAuthIssuerMismatchError.create(metadata?.issuer, iss);
  }
  const codeVerifier = yield* fromPromise(() => provider.codeVerifier());
  const tokens = yield* exchangeAuthorizationCode(discovered.authorizationServerUrl, {
    ...tokenOptions,
    code,
    codeVerifier,
    redirectUrl,
  });
  yield* fromPromise(() => provider.saveTokens(withScope(tokens, scope)));
  return "AUTHORIZED" as const;
});

const refreshIsFatal = (
  options: flowTypesModule.OAuthFlowOptions,
  error: flowTypes.OAuthFlowFailure,
): boolean =>
  options.signal?.aborted === true ||
  Schema.is(OAuthInsecureEndpointError)(error) ||
  (Schema.is(OAuthError)(error) && error.code !== "server_error");

const tryRefresh = Effect.fn("tryRefresh")(function* (
  context: FlowContext,
  tokenOptions: flowTypesModule.TokenRequestOptions,
) {
  const { provider, options, discovered } = context;
  const existing =
    options.skipRefresh === true ? undefined : yield* fromPromise(() => provider.tokens());
  const refreshToken = existing?.refresh_token;
  if (!present(refreshToken)) return false;
  return yield* refreshAuthorization(discovered.authorizationServerUrl, {
    ...tokenOptions,
    refreshToken,
  }).pipe(
    Effect.flatMap((tokens) =>
      fromPromise(() => provider.saveTokens(withScope(tokens, existing?.scope))),
    ),
    Effect.as(true),
    Effect.catchIf(
      (error) => !refreshIsFatal(options, error),
      () => Effect.succeed(false),
    ),
  );
});

const redirect = Effect.fn("redirect")(function* (
  context: FlowContext,
  client: typesModule.OAuthClientInformationMixed,
  redirectUrl: string | URL,
  resource: string | undefined,
) {
  const { provider, discovered, metadata, scope } = context;
  const state = yield* fromPromise(() => provider.state?.());
  const authorization = yield* startAuthorization(discovered.authorizationServerUrl, {
    clientInformation: client,
    metadata,
    redirectUrl,
    resource,
    scope,
    state,
  });
  yield* fromPromise(() => provider.saveCodeVerifier(authorization.codeVerifier));
  yield* fromPromise(() => provider.redirectToAuthorization(authorization.authorizationUrl));
  return "REDIRECT" as const;
});

const firstScope = (...scopes: (string | undefined)[]): string | undefined =>
  scopes.find((scope) => present(scope)) ?? scopes.at(-1);

const runFlow = Effect.fn("runFlow")(function* (
  provider: flowTypesModule.OAuthClientProvider,
  options: flowTypesModule.OAuthFlowOptions,
) {
  const { discovered, resource } = yield* discover(provider, options);
  const metadata = discovered.authorizationServerMetadata;
  const scope = firstScope(
    options.scope,
    discovered.resourceMetadata?.scopes_supported?.join(" "),
    provider.clientMetadata.scope,
  );
  const context: FlowContext = { discovered, metadata, options, provider, scope };
  const { client, clientDocument } = yield* resolveClient(context);
  const redirectUrl = clientDocument?.redirectUrl ?? provider.redirectUrl;
  const tokenOptions: flowTypesModule.TokenRequestOptions = {
    addClientAuthentication: provider.addClientAuthentication,
    clientInformation: client,
    fetch: options.fetch,
    metadata,
    resource,
    signal: options.signal,
  };
  const code = options.authorizationCode;
  if (present(code)) return yield* exchangeCode(context, code, tokenOptions, redirectUrl);
  if (yield* tryRefresh(context, tokenOptions)) return "AUTHORIZED" as const;
  return yield* redirect(context, client, redirectUrl, resource);
});

const invalidationFor = (error: flowTypes.OAuthFlowFailure): "all" | "tokens" | undefined => {
  if (!Schema.is(OAuthError)(error)) return undefined;
  if (error.code === "invalid_client" || error.code === "unauthorized_client") return "all";
  if (error.code === "invalid_grant") return "tokens";
  return undefined;
};

const authorizeMcpEffect = (
  provider: flowTypesModule.OAuthClientProvider,
  options: flowTypesModule.OAuthFlowOptions,
): Effect.Effect<flowTypesModule.OAuthFlowResult, flowTypes.OAuthFlowFailure> =>
  runFlow(provider, options).pipe(
    Effect.catch((error) => {
      const kind = invalidationFor(error);
      if (kind === undefined) return Effect.fail(error);
      return fromPromise(() => provider.invalidateCredentials?.(kind)).pipe(
        Effect.andThen(runFlow(provider, options)),
      );
    }),
  );

const authorizeMcp: {
  (
    options: flowTypesModule.OAuthFlowOptions,
  ): (
    provider: flowTypesModule.OAuthClientProvider,
  ) => Effect.Effect<flowTypesModule.OAuthFlowResult, flowTypes.OAuthFlowFailure>;
  (
    provider: flowTypesModule.OAuthClientProvider,
    options: flowTypesModule.OAuthFlowOptions,
  ): Effect.Effect<flowTypesModule.OAuthFlowResult, flowTypes.OAuthFlowFailure>;
} = dual(2, authorizeMcpEffect);

const flow = {
  authorizeMcp,
  stepUpScope,
};

export default flow;

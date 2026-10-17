import { Effect } from "effect";
import { dual } from "effect/Function";

import { fromPromise, type McpForeignError } from "../foreign.ts";
import { registerClient, startAuthorization } from "./authorization.ts";
import { discover } from "./discover.ts";
import { present } from "./endpoint.ts";
import {
  OAuthError,
  OAuthFlowError,
  OAuthInsecureEndpointError,
  OAuthIssuerMismatchError,
  type OAuthRegistrationError,
} from "./errors.ts";
import type {
  OAuthClientMetadataDocument,
  OAuthClientProvider,
  OAuthFlowOptions,
  OAuthFlowResult,
  TokenRequestOptions,
} from "./flow-types.ts";
import { exchangeAuthorizationCode, refreshAuthorization } from "./token.ts";
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthServerInfo,
  OAuthTokens,
} from "./types.ts";

export type OAuthFlowFailure =
  | McpForeignError
  | OAuthError
  | OAuthFlowError
  | OAuthInsecureEndpointError
  | OAuthIssuerMismatchError
  | OAuthRegistrationError;

interface FlowContext {
  provider: OAuthClientProvider;
  options: OAuthFlowOptions;
  discovered: OAuthServerInfo;
  metadata: AuthorizationServerMetadata | undefined;
  scope: string | undefined;
}

function withScope(tokens: OAuthTokens, scope: string | undefined): OAuthTokens {
  return tokens.scope === undefined && present(scope) ? { ...tokens, scope } : tokens;
}

export const stepUpScope: {
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
  const clientDocument: OAuthClientMetadataDocument | undefined =
    stored === undefined ? provider.clientMetadataDocument?.(metadata) : undefined;
  if (clientDocument !== undefined) {
    const url = new URL(clientDocument.url);
    if (url.protocol !== "https:" || url.pathname === "/")
      return yield* new OAuthFlowError("Invalid OAuth client metadata URL");
  }
  const known: OAuthClientInformationMixed | undefined =
    stored ?? (clientDocument === undefined ? undefined : { client_id: clientDocument.url });
  if (known !== undefined) return { client: known, clientDocument };
  if (present(options.authorizationCode))
    return yield* new OAuthFlowError("OAuth client information is missing during code exchange");
  const saveClientInformation = provider.saveClientInformation?.bind(provider);
  if (saveClientInformation === undefined)
    return yield* new OAuthFlowError("OAuth client information cannot be persisted");
  const registered = yield* registerClient(discovered.authorizationServerUrl, {
    metadata,
    clientMetadata: provider.clientMetadata,
    scope,
    fetch: options.fetch,
    signal: options.signal,
  });
  yield* fromPromise(() => saveClientInformation(registered));
  return { client: registered, clientDocument };
});

const exchangeCode = Effect.fn("exchangeCode")(function* (
  context: FlowContext,
  code: string,
  tokenOptions: TokenRequestOptions,
  redirectUrl: string | URL,
) {
  const { provider, options, discovered, metadata, scope } = context;
  const iss = options.iss;
  if (
    (iss !== undefined || metadata?.authorization_response_iss_parameter_supported === true) &&
    iss !== metadata?.issuer
  ) {
    return yield* new OAuthIssuerMismatchError(metadata?.issuer, iss);
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

const refreshIsFatal = (options: OAuthFlowOptions, error: OAuthFlowFailure): boolean =>
  options.signal?.aborted === true ||
  error instanceof OAuthInsecureEndpointError ||
  (error instanceof OAuthError && error.code !== "server_error");

const tryRefresh = Effect.fn("tryRefresh")(function* (
  context: FlowContext,
  tokenOptions: TokenRequestOptions,
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
  client: OAuthClientInformationMixed,
  redirectUrl: string | URL,
  resource: string | undefined,
) {
  const { provider, discovered, metadata, scope } = context;
  const state = yield* fromPromise(() => provider.state?.());
  const authorization = yield* startAuthorization(discovered.authorizationServerUrl, {
    metadata,
    clientInformation: client,
    redirectUrl,
    scope,
    state,
    resource,
  });
  yield* fromPromise(() => provider.saveCodeVerifier(authorization.codeVerifier));
  yield* fromPromise(() => provider.redirectToAuthorization(authorization.authorizationUrl));
  return "REDIRECT" as const;
});

const firstScope = (...scopes: (string | undefined)[]): string | undefined =>
  scopes.find((scope) => present(scope)) ?? scopes.at(-1);

const runFlow = Effect.fn("runFlow")(function* (
  provider: OAuthClientProvider,
  options: OAuthFlowOptions,
) {
  const { discovered, resource } = yield* discover(provider, options);
  const metadata = discovered.authorizationServerMetadata;
  const scope = firstScope(
    options.scope,
    discovered.resourceMetadata?.scopes_supported?.join(" "),
    provider.clientMetadata.scope,
  );
  const context: FlowContext = { provider, options, discovered, metadata, scope };
  const { client, clientDocument } = yield* resolveClient(context);
  const redirectUrl = clientDocument?.redirectUrl ?? provider.redirectUrl;
  const tokenOptions: TokenRequestOptions = {
    metadata,
    clientInformation: client,
    resource,
    addClientAuthentication: provider.addClientAuthentication,
    fetch: options.fetch,
    signal: options.signal,
  };
  const code = options.authorizationCode;
  if (present(code)) return yield* exchangeCode(context, code, tokenOptions, redirectUrl);
  if (yield* tryRefresh(context, tokenOptions)) return "AUTHORIZED" as const;
  return yield* redirect(context, client, redirectUrl, resource);
});

const invalidationFor = (error: OAuthFlowFailure): "all" | "tokens" | undefined => {
  if (!(error instanceof OAuthError)) return undefined;
  if (error.code === "invalid_client" || error.code === "unauthorized_client") return "all";
  if (error.code === "invalid_grant") return "tokens";
  return undefined;
};

const authorizeMcpEffect = (
  provider: OAuthClientProvider,
  options: OAuthFlowOptions,
): Effect.Effect<OAuthFlowResult, OAuthFlowFailure> =>
  runFlow(provider, options).pipe(
    Effect.catch((error) => {
      const kind = invalidationFor(error);
      if (kind === undefined) return Effect.fail(error);
      return fromPromise(() => provider.invalidateCredentials?.(kind)).pipe(
        Effect.andThen(runFlow(provider, options)),
      );
    }),
  );

export const authorizeMcp: {
  (
    options: OAuthFlowOptions,
  ): (provider: OAuthClientProvider) => Effect.Effect<OAuthFlowResult, OAuthFlowFailure>;
  (
    provider: OAuthClientProvider,
    options: OAuthFlowOptions,
  ): Effect.Effect<OAuthFlowResult, OAuthFlowFailure>;
} = dual(2, authorizeMcpEffect);

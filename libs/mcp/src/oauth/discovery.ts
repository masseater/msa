import { Effect } from "effect";
import { dual } from "effect/Function";

import type authProviderTypes from "../auth-provider.ts";
import type foreignTypes from "../foreign.types.ts";
import discoveryKit from "./discovery-kit.ts";
import type discoveryTypes from "./discovery.types.ts";
import type errorsTypes from "./errors.types.ts";
import resourceModule from "./resource.ts";
import typesModule2 from "./types.ts";
import type typesModule from "./types.types.ts";

const { endpoint, errors, foreign: foreignModule, types } = discoveryKit;

const { McpForeignError, fromPromise, fromSync } = foreignModule;
const { LATEST_PROTOCOL_VERSION } = types;
const { OAuthFlowError, OAuthIssuerMismatchError } = errors;
const { parseAuthorizationServerMetadata, parseProtectedResourceMetadata } = typesModule2;
const { isServerUrl } = endpoint;

type DiscoveryError =
  | foreignTypes.McpForeignError
  | errorsTypes.OAuthFlowError
  | errorsTypes.OAuthIssuerMismatchError;

function discard(response: Response | undefined): void {
  void response?.body?.cancel().catch(() => undefined);
}

function isDiscoveryMiss(status: number): boolean {
  return (status >= 400 && status < 500) || status === 502;
}

function pathSuffix(pathname: string): string {
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function field(header: string, name: string): string | undefined {
  const match = header.match(
    new RegExp(String.raw`(?:^|[,\s])${name}=(?:"([^"]*)"|([^\s,]+))`, "iu"),
  );
  const value = match?.[1] ?? match?.[2];
  return value === undefined || value === "" ? undefined : value;
}

function parseWwwAuthenticate(header: string | null): typesModule.OAuthChallenge {
  if (header === null || header === "") return {};
  const scheme = header.trimStart().split(/\s+/u, 1)[0]?.toLowerCase();
  if (scheme !== "bearer" && scheme !== "dpop") return {};
  const resourceMetadata = field(header, "resource_metadata");
  const resourceMetadataUrl =
    resourceMetadata !== undefined && URL.canParse(resourceMetadata)
      ? new URL(resourceMetadata)
      : undefined;
  return {
    error: field(header, "error"),
    errorDescription: field(header, "error_description"),
    resourceMetadataUrl,
    scope: field(header, "scope"),
  };
}

const fetchMetadata = (
  url: URL,
  fetch: authProviderTypes.McpFetch,
  protocolVersion: string,
  signal: AbortSignal | undefined,
): Effect.Effect<Response, foreignTypes.McpForeignError> =>
  fromPromise(() =>
    fetch(url, {
      headers: { Accept: "application/json", "MCP-Protocol-Version": protocolVersion },
      signal: signal ?? null,
    }),
  );

const readJson = (response: Response): Effect.Effect<unknown, foreignTypes.McpForeignError> =>
  fromPromise((): Promise<unknown> => response.json());

const discoverProtectedResourceMetadataEffect = Effect.fn("discoverProtectedResourceMetadata")(
  function* (
    serverUrl: string | URL,
    options: discoveryTypes.ProtectedResourceDiscoveryOptions = {},
  ) {
    const server = new URL(serverUrl);
    const fetch = options.fetch ?? globalThis.fetch;
    const version = options.protocolVersion ?? LATEST_PROTOCOL_VERSION;
    const configured = options.resourceMetadataUrl;
    let response = yield* fetchMetadata(
      configured === undefined
        ? new URL(
            `/.well-known/oauth-protected-resource${pathSuffix(server.pathname)}`,
            server.origin,
          )
        : new URL(configured),
      fetch,
      version,
      options.signal,
    );
    if (configured === undefined && server.pathname !== "/" && isDiscoveryMiss(response.status)) {
      discard(response);
      response = yield* fetchMetadata(
        new URL("/.well-known/oauth-protected-resource", server.origin),
        fetch,
        version,
        options.signal,
      );
    }
    if (!response.ok) {
      discard(response);
      return yield* new OAuthFlowError(
        `HTTP ${response.status} loading OAuth protected resource metadata`,
      );
    }
    const body = yield* readJson(response);
    return yield* fromSync(() => parseProtectedResourceMetadata(body));
  },
);

const discoverProtectedResourceMetadata: {
  (
    options?: discoveryTypes.ProtectedResourceDiscoveryOptions,
  ): (
    serverUrl: string | URL,
  ) => Effect.Effect<
    typesModule.OAuthProtectedResourceMetadata,
    foreignTypes.McpForeignError | errorsTypes.OAuthFlowError
  >;
  (
    serverUrl: string | URL,
    options?: discoveryTypes.ProtectedResourceDiscoveryOptions,
  ): Effect.Effect<
    typesModule.OAuthProtectedResourceMetadata,
    foreignTypes.McpForeignError | errorsTypes.OAuthFlowError
  >;
} = dual(isServerUrl, discoverProtectedResourceMetadataEffect);

function buildAuthorizationServerDiscoveryUrls(
  authorizationServerUrl: string | URL,
): { url: URL; type: "oauth" | "oidc" }[] {
  const issuer = new URL(authorizationServerUrl);
  const path = pathSuffix(issuer.pathname);
  const urls: { url: URL; type: "oauth" | "oidc" }[] = [
    {
      type: "oauth",
      url: new URL(`/.well-known/oauth-authorization-server${path}`, issuer.origin),
    },
    { type: "oidc", url: new URL(`/.well-known/openid-configuration${path}`, issuer.origin) },
  ];
  if (path !== "")
    urls.push({
      type: "oidc",
      url: new URL(`${path}/.well-known/openid-configuration`, issuer.origin),
    });
  return urls;
}

const trimSlash = (value: string): string => (value.endsWith("/") ? value.slice(0, -1) : value);

const discoverAuthorizationServerMetadataEffect = Effect.fn("discoverAuthorizationServerMetadata")(
  function* (
    authorizationServerUrl: string | URL,
    options: discoveryTypes.AuthorizationServerDiscoveryOptions = {},
  ) {
    const fetch = options.fetch ?? globalThis.fetch;
    for (const { url } of buildAuthorizationServerDiscoveryUrls(authorizationServerUrl)) {
      const response = yield* fetchMetadata(
        url,
        fetch,
        options.protocolVersion ?? LATEST_PROTOCOL_VERSION,
        options.signal,
      );
      if (!response.ok) {
        discard(response);
        if (isDiscoveryMiss(response.status)) continue;
        return yield* new OAuthFlowError(
          `HTTP ${response.status} loading authorization server metadata from ${url}`,
        );
      }
      const body = yield* readJson(response);
      const metadata = yield* fromSync(() => parseAuthorizationServerMetadata(body));
      if (options.skipIssuerValidation !== true) {
        const expected = String(authorizationServerUrl);
        if (trimSlash(metadata.issuer) !== trimSlash(expected))
          return yield* new OAuthIssuerMismatchError(expected, metadata.issuer);
      }
      return metadata;
    }
    return undefined;
  },
);

const discoverAuthorizationServerMetadata: {
  (
    options?: discoveryTypes.AuthorizationServerDiscoveryOptions,
  ): (
    authorizationServerUrl: string | URL,
  ) => Effect.Effect<typesModule.AuthorizationServerMetadata | undefined, DiscoveryError>;
  (
    authorizationServerUrl: string | URL,
    options?: discoveryTypes.AuthorizationServerDiscoveryOptions,
  ): Effect.Effect<typesModule.AuthorizationServerMetadata | undefined, DiscoveryError>;
} = dual(isServerUrl, discoverAuthorizationServerMetadataEffect);

const isNetworkFailure = (error: unknown): boolean =>
  error instanceof McpForeignError && error.cause instanceof TypeError;

const configuredServerInfo = Effect.fn("configuredServerInfo")(function* (
  url: URL,
  options: discoveryTypes.OAuthServerInfoDiscoveryOptions,
  resourceMetadata: typesModule.OAuthProtectedResourceMetadata | undefined,
) {
  const response = yield* fetchMetadata(
    url,
    options.fetch ?? globalThis.fetch,
    LATEST_PROTOCOL_VERSION,
    options.signal,
  );
  if (!response.ok) {
    discard(response);
    return yield* new OAuthFlowError(
      `HTTP ${response.status} loading authorization server metadata from ${url}`,
    );
  }
  const body = yield* readJson(response);
  const metadata = yield* fromSync(() => parseAuthorizationServerMetadata(body));
  return {
    authorizationServerMetadata: metadata,
    authorizationServerUrl: metadata.issuer,
    resourceMetadata,
  } satisfies typesModule.OAuthServerInfo;
});

const discoverOAuthServerInfoEffect = Effect.fn("discoverOAuthServerInfo")(function* (
  serverUrl: string | URL,
  options: discoveryTypes.OAuthServerInfoDiscoveryOptions = {},
) {
  const resourceMetadata = yield* discoverProtectedResourceMetadata(serverUrl, {
    fetch: options.fetch,
    resourceMetadataUrl: options.resourceMetadataUrl,
    signal: options.signal,
  }).pipe(
    Effect.catchIf(
      (error) => !isNetworkFailure(error),
      () => Effect.undefined,
    ),
  );
  if (options.authorizationServerMetadataUrl !== undefined)
    return yield* configuredServerInfo(
      options.authorizationServerMetadataUrl,
      options,
      resourceMetadata,
    );
  const authorizationServerUrl =
    resourceMetadata?.authorization_servers?.[0] ?? String(new URL("/", serverUrl));
  const info: typesModule.OAuthServerInfo = {
    authorizationServerMetadata: yield* discoverAuthorizationServerMetadata(
      authorizationServerUrl,
      {
        fetch: options.fetch,
        signal: options.signal,
        skipIssuerValidation: options.skipIssuerValidation,
      },
    ),
    authorizationServerUrl,
    resourceMetadata,
  };
  return info;
});

const discoverOAuthServerInfo: {
  (
    options?: discoveryTypes.OAuthServerInfoDiscoveryOptions,
  ): (serverUrl: string | URL) => Effect.Effect<typesModule.OAuthServerInfo, DiscoveryError>;
  (
    serverUrl: string | URL,
    options?: discoveryTypes.OAuthServerInfoDiscoveryOptions,
  ): Effect.Effect<typesModule.OAuthServerInfo, DiscoveryError>;
} = dual(isServerUrl, discoverOAuthServerInfoEffect);

const discovery = {
  buildAuthorizationServerDiscoveryUrls,
  discoverAuthorizationServerMetadata,
  discoverOAuthServerInfo,
  discoverProtectedResourceMetadata,
  parseWwwAuthenticate,
  resourceUrlFromServerUrl: resourceModule.resourceUrlFromServerUrl,
  selectResource: resourceModule.selectResource,
};

export default discovery;

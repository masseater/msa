import { Effect } from "effect";
import { dual } from "effect/Function";

import type { McpFetch } from "../auth-provider.ts";
import { fromPromise, fromSync, McpForeignError } from "../foreign.ts";
import { LATEST_PROTOCOL_VERSION } from "../protocol/types.ts";
import { isServerUrl } from "./endpoint.ts";
import { OAuthFlowError, OAuthIssuerMismatchError } from "./errors.ts";
import {
  type AuthorizationServerMetadata,
  type OAuthChallenge,
  type OAuthProtectedResourceMetadata,
  type OAuthServerInfo,
  parseAuthorizationServerMetadata,
  parseProtectedResourceMetadata,
} from "./types.ts";

export interface ProtectedResourceDiscoveryOptions {
  resourceMetadataUrl?: string | URL | undefined;
  protocolVersion?: string | undefined;
  fetch?: McpFetch | undefined;
  signal?: AbortSignal | undefined;
}

export interface AuthorizationServerDiscoveryOptions {
  fetch?: McpFetch | undefined;
  protocolVersion?: string | undefined;
  skipIssuerValidation?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export interface OAuthServerInfoDiscoveryOptions {
  resourceMetadataUrl?: URL | undefined;
  authorizationServerMetadataUrl?: URL | undefined;
  fetch?: McpFetch | undefined;
  skipIssuerValidation?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

type DiscoveryError = McpForeignError | OAuthFlowError | OAuthIssuerMismatchError;

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

export function parseWwwAuthenticate(header: string | null): OAuthChallenge {
  if (header === null || header === "") return {};
  const scheme = header.trimStart().split(/\s+/u, 1)[0]?.toLowerCase();
  if (scheme !== "bearer" && scheme !== "dpop") return {};
  const resourceMetadata = field(header, "resource_metadata");
  const resourceMetadataUrl =
    resourceMetadata !== undefined && URL.canParse(resourceMetadata)
      ? new URL(resourceMetadata)
      : undefined;
  return {
    resourceMetadataUrl,
    scope: field(header, "scope"),
    error: field(header, "error"),
    errorDescription: field(header, "error_description"),
  };
}

const fetchMetadata = (
  url: URL,
  fetch: McpFetch,
  protocolVersion: string,
  signal: AbortSignal | undefined,
): Effect.Effect<Response, McpForeignError> =>
  fromPromise(() =>
    fetch(url, {
      headers: { Accept: "application/json", "MCP-Protocol-Version": protocolVersion },
      signal: signal ?? null,
    }),
  );

const readJson = (response: Response): Effect.Effect<unknown, McpForeignError> =>
  fromPromise((): Promise<unknown> => response.json());

const discoverProtectedResourceMetadataEffect = Effect.fn("discoverProtectedResourceMetadata")(
  function* (serverUrl: string | URL, options: ProtectedResourceDiscoveryOptions = {}) {
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

export const discoverProtectedResourceMetadata: {
  (
    options?: ProtectedResourceDiscoveryOptions,
  ): (
    serverUrl: string | URL,
  ) => Effect.Effect<OAuthProtectedResourceMetadata, McpForeignError | OAuthFlowError>;
  (
    serverUrl: string | URL,
    options?: ProtectedResourceDiscoveryOptions,
  ): Effect.Effect<OAuthProtectedResourceMetadata, McpForeignError | OAuthFlowError>;
} = dual(isServerUrl, discoverProtectedResourceMetadataEffect);

export function buildAuthorizationServerDiscoveryUrls(
  authorizationServerUrl: string | URL,
): { url: URL; type: "oauth" | "oidc" }[] {
  const issuer = new URL(authorizationServerUrl);
  const path = pathSuffix(issuer.pathname);
  const urls: { url: URL; type: "oauth" | "oidc" }[] = [
    {
      url: new URL(`/.well-known/oauth-authorization-server${path}`, issuer.origin),
      type: "oauth",
    },
    { url: new URL(`/.well-known/openid-configuration${path}`, issuer.origin), type: "oidc" },
  ];
  if (path !== "")
    urls.push({
      url: new URL(`${path}/.well-known/openid-configuration`, issuer.origin),
      type: "oidc",
    });
  return urls;
}

const trimSlash = (value: string): string => (value.endsWith("/") ? value.slice(0, -1) : value);

const discoverAuthorizationServerMetadataEffect = Effect.fn("discoverAuthorizationServerMetadata")(
  function* (
    authorizationServerUrl: string | URL,
    options: AuthorizationServerDiscoveryOptions = {},
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

export const discoverAuthorizationServerMetadata: {
  (
    options?: AuthorizationServerDiscoveryOptions,
  ): (
    authorizationServerUrl: string | URL,
  ) => Effect.Effect<AuthorizationServerMetadata | undefined, DiscoveryError>;
  (
    authorizationServerUrl: string | URL,
    options?: AuthorizationServerDiscoveryOptions,
  ): Effect.Effect<AuthorizationServerMetadata | undefined, DiscoveryError>;
} = dual(isServerUrl, discoverAuthorizationServerMetadataEffect);

const isNetworkFailure = (error: unknown): boolean =>
  error instanceof McpForeignError && error.cause instanceof TypeError;

const configuredServerInfo = Effect.fn("configuredServerInfo")(function* (
  url: URL,
  options: OAuthServerInfoDiscoveryOptions,
  resourceMetadata: OAuthProtectedResourceMetadata | undefined,
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
    authorizationServerUrl: metadata.issuer,
    authorizationServerMetadata: metadata,
    resourceMetadata,
  } satisfies OAuthServerInfo;
});

const discoverOAuthServerInfoEffect = Effect.fn("discoverOAuthServerInfo")(function* (
  serverUrl: string | URL,
  options: OAuthServerInfoDiscoveryOptions = {},
) {
  const resourceMetadata = yield* discoverProtectedResourceMetadata(serverUrl, {
    resourceMetadataUrl: options.resourceMetadataUrl,
    fetch: options.fetch,
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
  const info: OAuthServerInfo = {
    authorizationServerUrl,
    authorizationServerMetadata: yield* discoverAuthorizationServerMetadata(
      authorizationServerUrl,
      {
        fetch: options.fetch,
        skipIssuerValidation: options.skipIssuerValidation,
        signal: options.signal,
      },
    ),
    resourceMetadata,
  };
  return info;
});

export const discoverOAuthServerInfo: {
  (
    options?: OAuthServerInfoDiscoveryOptions,
  ): (serverUrl: string | URL) => Effect.Effect<OAuthServerInfo, DiscoveryError>;
  (
    serverUrl: string | URL,
    options?: OAuthServerInfoDiscoveryOptions,
  ): Effect.Effect<OAuthServerInfo, DiscoveryError>;
} = dual(isServerUrl, discoverOAuthServerInfoEffect);

export { resourceUrlFromServerUrl, selectResource } from "./resource.ts";

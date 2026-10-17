import { Effect } from "effect";

import { fromPromise, fromSync } from "../foreign.ts";
import { discoverAuthorizationServerMetadata, discoverOAuthServerInfo } from "./discovery.ts";
import { present, secureEndpoint } from "./endpoint.ts";
import type { OAuthClientProvider, OAuthFlowOptions } from "./flow-types.ts";
import { selectResource } from "./resource.ts";
import type { OAuthServerInfo } from "./types.ts";

const discoverServer = Effect.fn("discoverServer")(function* (
  provider: OAuthClientProvider,
  options: OAuthFlowOptions,
) {
  const configured = options.authorizationServerMetadataUrl;
  const metadataUrl = configured === undefined ? undefined : yield* secureEndpoint(configured);
  const cached =
    metadataUrl === undefined ? yield* fromPromise(() => provider.discoveryState?.()) : undefined;
  const cachedUrl = cached?.authorizationServerUrl;
  const discovered: OAuthServerInfo = present(cachedUrl)
    ? {
        authorizationServerUrl: cachedUrl,
        authorizationServerMetadata:
          cached?.authorizationServerMetadata ??
          (yield* discoverAuthorizationServerMetadata(cachedUrl, {
            fetch: options.fetch,
            skipIssuerValidation: options.skipIssuerValidation,
            signal: options.signal,
          })),
        resourceMetadata: cached?.resourceMetadata,
      }
    : yield* discoverOAuthServerInfo(options.serverUrl, {
        resourceMetadataUrl: options.resourceMetadataUrl,
        authorizationServerMetadataUrl: metadataUrl,
        fetch: options.fetch,
        skipIssuerValidation: options.skipIssuerValidation,
        signal: options.signal,
      });
  if (metadataUrl === undefined) {
    const resourceMetadataUrl = options.resourceMetadataUrl;
    yield* fromPromise(() =>
      provider.saveDiscoveryState?.({
        ...discovered,
        ...(resourceMetadataUrl === undefined
          ? {}
          : { resourceMetadataUrl: resourceMetadataUrl.href }),
      }),
    );
  }
  return discovered;
});

export const discover = Effect.fn("discover")(function* (
  provider: OAuthClientProvider,
  options: OAuthFlowOptions,
) {
  const discovered = yield* discoverServer(provider, options);
  const resource = yield* fromSync(() =>
    selectResource(options.serverUrl, discovered.resourceMetadata),
  );
  return { discovered, resource };
});

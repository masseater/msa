import { Effect } from "effect";

import foreignModule from "../foreign.ts";
import discovery from "./discovery.ts";
import endpoint from "./endpoint.ts";
import type flowTypesModule from "./flow-types.ts";
import resourceModule from "./resource.ts";
import type typesModule from "./types.types.ts";

const { present, secureEndpoint } = endpoint;
const { fromPromise, fromSync } = foreignModule;
const { discoverAuthorizationServerMetadata, discoverOAuthServerInfo } = discovery;
const { selectResource } = resourceModule;

const discoverServer = Effect.fn("discoverServer")(function* (
  provider: flowTypesModule.OAuthClientProvider,
  options: flowTypesModule.OAuthFlowOptions,
) {
  const configured = options.authorizationServerMetadataUrl;
  const metadataUrl = configured === undefined ? undefined : yield* secureEndpoint(configured);
  const cached =
    metadataUrl === undefined ? yield* fromPromise(() => provider.discoveryState?.()) : undefined;
  const cachedUrl = cached?.authorizationServerUrl;
  const discovered: typesModule.OAuthServerInfo = present(cachedUrl)
    ? {
        authorizationServerMetadata:
          cached?.authorizationServerMetadata ??
          (yield* discoverAuthorizationServerMetadata(cachedUrl, {
            fetch: options.fetch,
            signal: options.signal,
            skipIssuerValidation: options.skipIssuerValidation,
          })),
        authorizationServerUrl: cachedUrl,
        resourceMetadata: cached?.resourceMetadata,
      }
    : yield* discoverOAuthServerInfo(options.serverUrl, {
        authorizationServerMetadataUrl: metadataUrl,
        fetch: options.fetch,
        resourceMetadataUrl: options.resourceMetadataUrl,
        signal: options.signal,
        skipIssuerValidation: options.skipIssuerValidation,
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

const discover = Effect.fn("discover")(function* (
  provider: flowTypesModule.OAuthClientProvider,
  options: flowTypesModule.OAuthFlowOptions,
) {
  const discovered = yield* discoverServer(provider, options);
  const resource = yield* fromSync(() =>
    selectResource(options.serverUrl, discovered.resourceMetadata),
  );
  return { discovered, resource };
});

const discoverModule = {
  discover,
};

export default discoverModule;

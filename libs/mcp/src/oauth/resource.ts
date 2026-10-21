import { dual } from "effect/Function";

import endpoint from "./endpoint.ts";
import type typesModule from "./types.types.ts";

const { isServerUrl } = endpoint;

function resourceUrlFromServerUrl(value: string | URL): URL {
  const url = new URL(value);
  url.hash = "";
  return url;
}

const withTrailingSlash = (pathname: string): string =>
  pathname.endsWith("/") ? pathname : `${pathname}/`;

const selectResourceFor = (
  serverUrl: string | URL,
  metadata?: typesModule.OAuthProtectedResourceMetadata,
): string | undefined => {
  if (metadata === undefined) return undefined;
  const requested = resourceUrlFromServerUrl(serverUrl);
  const configured = new URL(metadata.resource);
  if (
    requested.origin !== configured.origin ||
    !withTrailingSlash(requested.pathname).startsWith(withTrailingSlash(configured.pathname))
  ) {
    throw new Error(
      `Protected resource ${metadata.resource} does not match MCP server ${requested}`,
    );
  }
  return metadata.resource;
};

const selectResource: {
  (
    metadata?: typesModule.OAuthProtectedResourceMetadata,
  ): (serverUrl: string | URL) => string | undefined;
  (
    serverUrl: string | URL,
    metadata?: typesModule.OAuthProtectedResourceMetadata,
  ): string | undefined;
} = dual(isServerUrl, selectResourceFor);

const resourceModule = {
  resourceUrlFromServerUrl,
  selectResource,
};

export default resourceModule;

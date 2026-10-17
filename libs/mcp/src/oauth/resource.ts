import { dual } from "effect/Function";

import { isServerUrl } from "./endpoint.ts";
import type { OAuthProtectedResourceMetadata } from "./types.ts";

export function resourceUrlFromServerUrl(value: string | URL): URL {
  const url = new URL(value);
  url.hash = "";
  return url;
}

const withTrailingSlash = (pathname: string): string =>
  pathname.endsWith("/") ? pathname : `${pathname}/`;

const selectResourceFor = (
  serverUrl: string | URL,
  metadata?: OAuthProtectedResourceMetadata,
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

export const selectResource: {
  (metadata?: OAuthProtectedResourceMetadata): (serverUrl: string | URL) => string | undefined;
  (serverUrl: string | URL, metadata?: OAuthProtectedResourceMetadata): string | undefined;
} = dual(isServerUrl, selectResourceFor);

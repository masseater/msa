import { Effect } from "effect";

import { OAuthInsecureEndpointError } from "./errors.ts";

export const present = (value: string | undefined): value is string =>
  value !== undefined && value !== "";

export const isServerUrl = (args: IArguments): boolean =>
  typeof args[0] === "string" || args[0] instanceof URL;

export function loopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

export function applicationType(redirectUris: readonly string[]): "native" | "web" {
  const native = redirectUris.some((uri) => {
    if (!URL.canParse(uri)) return false;
    const url = new URL(uri);
    return (url.protocol !== "http:" && url.protocol !== "https:") || loopback(url.hostname);
  });
  return native ? "native" : "web";
}

export const secureEndpoint = (
  value: string | URL,
): Effect.Effect<URL, OAuthInsecureEndpointError> =>
  Effect.suspend(() => {
    const url = new URL(value);
    if (url.protocol !== "https:" && !loopback(url.hostname))
      return Effect.fail(new OAuthInsecureEndpointError(url.href));
    return Effect.succeed(url);
  });

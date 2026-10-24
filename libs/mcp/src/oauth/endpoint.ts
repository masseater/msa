import { Effect } from "effect";

import errors from "./errors.ts";
import type errorsTypes from "./errors.types.ts";

const { OAuthInsecureEndpointError } = errors;

const present = (value: string | undefined): value is string => value !== undefined && value !== "";

const isServerUrl = (args: IArguments): boolean =>
  typeof args[0] === "string" || args[0] instanceof URL;

function loopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function applicationType(redirectUris: readonly string[]): "native" | "web" {
  const native = redirectUris.some((uri) => {
    if (!URL.canParse(uri)) return false;
    const url = new URL(uri);
    return (url.protocol !== "http:" && url.protocol !== "https:") || loopback(url.hostname);
  });
  return native ? "native" : "web";
}

const secureEndpoint = (
  value: string | URL,
): Effect.Effect<URL, errorsTypes.OAuthInsecureEndpointError> =>
  Effect.suspend(() => {
    const url = new URL(value);
    if (url.protocol !== "https:" && !loopback(url.hostname))
      return Effect.fail(OAuthInsecureEndpointError.create(url.href));
    return Effect.succeed(url);
  });

const endpoint = {
  applicationType,
  isServerUrl,
  loopback,
  present,
  secureEndpoint,
};

export default endpoint;

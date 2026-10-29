import jsonrpcModule from "../protocol/jsonrpc.ts";
import type typesModule from "./types.types.ts";

const { isObject } = jsonrpcModule;

function object(value: unknown, name: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`Invalid ${name}`);
  return value;
}

type Compacted<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

function compact<T extends object>(value: T): Compacted<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Compacted<T>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${name}`);
  return value;
}

function absent(value: unknown): value is undefined | null | "" {
  return value === undefined || value === null || value === "";
}

function optionalString(value: unknown, name: string): string | undefined {
  if (absent(value)) return undefined;
  return requiredString(value, name);
}

function optionalStrings(value: unknown, name: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`Invalid ${name}`);
  return [...value];
}

function safeUrl(value: unknown, name: string): string {
  const text = requiredString(value, name);
  if (!URL.canParse(text)) throw new Error(`Invalid ${name}`);
  const url = new URL(text);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`Invalid ${name}`);
  return text;
}

function optionalUrl(value: unknown, name: string): string | undefined {
  return absent(value) ? undefined : safeUrl(value, name);
}

function parseProtectedResourceMetadata(
  value: unknown,
): typesModule.OAuthProtectedResourceMetadata {
  const input = object(value, "OAuth protected resource metadata");
  return compact({
    ...input,
    authorization_servers: optionalStrings(
      input["authorization_servers"],
      "authorization_servers",
    )?.map((url) => safeUrl(url, "authorization server URL")),
    resource: safeUrl(input["resource"], "OAuth protected resource metadata resource"),
    scopes_supported: optionalStrings(input["scopes_supported"], "scopes_supported"),
  });
}

function parseAuthorizationServerMetadata(value: unknown): typesModule.AuthorizationServerMetadata {
  const input = object(value, "authorization server metadata");
  const responseTypes = optionalStrings(
    input["response_types_supported"],
    "response_types_supported",
  );
  if (responseTypes === undefined) throw new Error("Invalid response_types_supported");
  return compact({
    ...input,
    authorization_endpoint: safeUrl(input["authorization_endpoint"], "authorization endpoint"),
    authorization_response_iss_parameter_supported:
      typeof input["authorization_response_iss_parameter_supported"] === "boolean"
        ? input["authorization_response_iss_parameter_supported"]
        : undefined,
    client_id_metadata_document_supported:
      typeof input["client_id_metadata_document_supported"] === "boolean"
        ? input["client_id_metadata_document_supported"]
        : undefined,
    code_challenge_methods_supported: optionalStrings(
      input["code_challenge_methods_supported"],
      "code_challenge_methods_supported",
    ),
    grant_types_supported: optionalStrings(input["grant_types_supported"], "grant_types_supported"),
    issuer: safeUrl(input["issuer"], "authorization server issuer"),
    registration_endpoint: optionalUrl(input["registration_endpoint"], "registration endpoint"),
    response_types_supported: responseTypes,
    scopes_supported: optionalStrings(input["scopes_supported"], "scopes_supported"),
    token_endpoint: safeUrl(input["token_endpoint"], "token endpoint"),
    token_endpoint_auth_methods_supported: optionalStrings(
      input["token_endpoint_auth_methods_supported"],
      "token_endpoint_auth_methods_supported",
    ),
  });
}

function parseOAuthTokens(value: unknown): typesModule.OAuthTokens {
  const input = object(value, "OAuth token response");
  const expires = absent(input["expires_in"]) ? undefined : Number(input["expires_in"]);
  if (expires !== undefined && !Number.isFinite(expires)) throw new Error("Invalid expires_in");
  return compact({
    access_token: requiredString(input["access_token"], "access_token"),
    expires_in: expires,
    id_token: optionalString(input["id_token"], "id_token"),
    refresh_token: optionalString(input["refresh_token"], "refresh_token"),
    scope: optionalString(input["scope"], "scope"),
    token_type: requiredString(input["token_type"], "token_type"),
  });
}

function parseClientInformation(value: unknown): typesModule.OAuthClientInformationFull {
  const input = object(value, "OAuth client registration response");
  return compact({
    ...(input as unknown as typesModule.OAuthClientMetadata),
    client_id: requiredString(input["client_id"], "client_id"),
    client_id_issued_at:
      typeof input["client_id_issued_at"] === "number" ? input["client_id_issued_at"] : undefined,
    client_secret: optionalString(input["client_secret"], "client_secret"),
    client_secret_expires_at:
      typeof input["client_secret_expires_at"] === "number"
        ? input["client_secret_expires_at"]
        : undefined,
    redirect_uris: optionalStrings(input["redirect_uris"], "redirect_uris") ?? [],
  });
}

const types = {
  parseAuthorizationServerMetadata,
  parseClientInformation,
  parseOAuthTokens,
  parseProtectedResourceMetadata,
};

export default types;

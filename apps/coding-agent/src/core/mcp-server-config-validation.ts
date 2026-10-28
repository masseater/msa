import type mcpServersTypes from "./mcp-servers.types.ts";

const MCP_EXPOSURES: readonly string[] = [
  "codemode",
  "deferred",
  "direct",
  "hidden",
] satisfies mcpServersTypes.McpExposure[];
const MCP_EXPOSURE_ALIASES: ReadonlyMap<string, mcpServersTypes.McpExposure> = new Map([
  ["codemode-deferred", "codemode"],
]);
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const SERVER_NAME = /^[A-Za-z0-9_-]+$/u;

type Check = () => string | undefined;

const firstError = (checks: readonly Check[]): string | undefined => {
  for (const check of checks) {
    const error = check();
    if (error !== undefined && error !== "") return error;
  }
  return undefined;
};

function isLoopbackRedirectUri(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.includes(url.hostname) &&
    url.search === "" &&
    url.hash === ""
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

const optionalString =
  (value: Record<string, unknown>, key: "clientId" | "clientSecret" | "scope"): Check =>
  () =>
    value[key] !== undefined && typeof value[key] !== "string"
      ? `oauth.${key} must be a string`
      : undefined;

function checkOAuthCallback(value: Record<string, unknown>): string | undefined {
  const port = value["callbackPort"];
  if (
    port !== undefined &&
    (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)
  ) {
    return "oauth.callbackPort must be a port number";
  }
  const callbackUrl = value["callbackUrl"];
  if (callbackUrl === undefined) return undefined;
  if (typeof callbackUrl !== "string" || !isLoopbackRedirectUri(callbackUrl)) {
    return "oauth.callbackUrl must be an http URI on localhost, 127.0.0.1, or [::1] without query or fragment";
  }
  const urlPort = new URL(callbackUrl).port;
  return urlPort !== "" && port !== undefined && Number(urlPort) !== port
    ? "oauth.callbackUrl and oauth.callbackPort name different ports"
    : undefined;
}

function checkOAuthRegistration(value: Record<string, unknown>): string | undefined {
  const registration = value["clientRegistration"];
  if (registration === undefined || registration === "dcr") return undefined;
  if (registration !== "cimd") return 'oauth.clientRegistration must be "dcr" or "cimd"';
  if (value["clientId"] !== undefined || value["clientName"] !== undefined) {
    return 'oauth.clientRegistration "cimd" cannot be combined with oauth.clientId or oauth.clientName';
  }
  const callback =
    typeof value["callbackUrl"] === "string" ? new URL(value["callbackUrl"]) : undefined;
  return callback !== undefined &&
    (callback.hostname === "[::1]" || callback.pathname !== "/callback")
    ? 'oauth.clientRegistration "cimd" requires oauth.callbackUrl on localhost or 127.0.0.1 with path /callback'
    : undefined;
}

function checkOAuthMetadataUrl(value: Record<string, unknown>): string | undefined {
  const metadataUrl = value["authServerMetadataUrl"];
  if (metadataUrl === undefined) return undefined;
  const url =
    typeof metadataUrl === "string" && URL.canParse(metadataUrl) ? new URL(metadataUrl) : undefined;
  const allowed =
    url !== undefined &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname)));
  return allowed
    ? undefined
    : "oauth.authServerMetadataUrl must be an https URL, or http on localhost, 127.0.0.1, or [::1]";
}

function validateOAuth(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return "oauth must be an object";
  return firstError([
    optionalString(value, "clientId"),
    optionalString(value, "clientSecret"),
    () => checkOAuthCallback(value),
    optionalString(value, "scope"),
    () =>
      value["clientName"] !== undefined &&
      (typeof value["clientName"] !== "string" || value["clientName"].trim() === "")
        ? "oauth.clientName must be a non-empty string"
        : undefined,
    () => checkOAuthRegistration(value),
    () => checkOAuthMetadataUrl(value),
  ]);
}

function isExposure(value: unknown): value is mcpServersTypes.McpExposure {
  return typeof value === "string" && MCP_EXPOSURES.includes(value);
}

function resolveExposureAlias(value: unknown): unknown {
  return typeof value === "string" ? (MCP_EXPOSURE_ALIASES.get(value) ?? value) : value;
}

function resolveExposureAliases(value: Record<string, unknown>): Record<string, unknown> {
  const { exposure, toolExposure } = value;
  const resolved: Record<string, unknown> = { ...value };
  if (exposure !== undefined) resolved["exposure"] = resolveExposureAlias(exposure);
  if (isRecord(toolExposure)) {
    resolved["toolExposure"] = Object.fromEntries(
      Object.entries(toolExposure).map(([tool, entry]) => [tool, resolveExposureAlias(entry)]),
    );
  }
  return resolved;
}

function checkExposure(value: Record<string, unknown>): string | undefined {
  const { exposure, toolExposure } = value;
  const exposures = MCP_EXPOSURES.map((exposureName) => `"${exposureName}"`).join(", ");
  if (exposure !== undefined && !isExposure(exposure)) {
    return `exposure must be one of ${exposures}`;
  }
  if (toolExposure === undefined) return undefined;
  if (!isRecord(toolExposure)) return "toolExposure must map tool names to exposures";
  const invalid = Object.entries(toolExposure).find(([, toolValue]) => !isExposure(toolValue));
  return invalid === undefined
    ? undefined
    : `toolExposure "${invalid[0]}" must be one of ${exposures}`;
}

function checkCommonFields(value: Record<string, unknown>): string | undefined {
  const { enabled, timeout, description } = value;
  return firstError([
    () => checkExposure(value),
    () =>
      enabled !== undefined && typeof enabled !== "boolean"
        ? "enabled must be a boolean"
        : undefined,
    () =>
      description !== undefined && typeof description !== "string"
        ? "description must be a string"
        : undefined,
    () =>
      timeout !== undefined && (typeof timeout !== "number" || !(timeout > 0))
        ? "timeout must be a positive number of seconds"
        : undefined,
    () =>
      value["type"] === "sse"
        ? "legacy SSE transport is not supported; use the streamable HTTP URL"
        : undefined,
  ]);
}

function checkHttpAuth(value: Record<string, unknown>, url: URL): string | undefined {
  const auth = value["auth"];
  if (auth === undefined) return undefined;
  if (!isRecord(auth) || typeof auth["provider"] !== "string" || auth["provider"] === "") {
    return "auth.provider must be a provider name";
  }
  return url.protocol !== "https:" && !LOOPBACK_HOSTS.includes(url.hostname)
    ? "auth requires an https URL, or http on localhost, 127.0.0.1, or [::1]"
    : undefined;
}

function checkHttpServer(value: Record<string, unknown>, rawUrl: string): string | undefined {
  if (!URL.canParse(rawUrl) || !/^https?:$/u.test(new URL(rawUrl).protocol)) {
    return "url must be an http or https URL";
  }
  return firstError([
    () =>
      value["headers"] !== undefined && !isStringRecord(value["headers"])
        ? "headers must map names to strings"
        : undefined,
    () => validateOAuth(value["oauth"]),
    () => checkHttpAuth(value, new URL(rawUrl)),
  ]);
}

function checkStdioServer(value: Record<string, unknown>): string | undefined {
  const args = value["args"];
  return firstError([
    () =>
      args !== undefined && !(Array.isArray(args) && args.every((arg) => typeof arg === "string"))
        ? "args must be an array of strings"
        : undefined,
    () =>
      value["env"] !== undefined && !isStringRecord(value["env"])
        ? "env must map names to strings"
        : undefined,
    () =>
      value["cwd"] !== undefined && typeof value["cwd"] !== "string"
        ? "cwd must be a string"
        : undefined,
  ]);
}

function validateMcpServerConfig(
  name: string,
  raw: unknown,
): mcpServersTypes.McpServerConfig | string {
  if (!SERVER_NAME.test(name))
    return `invalid server name "${name}" (use letters, digits, "_" and "-")`;
  if (!isRecord(raw)) return `server "${name}" must be an object`;
  const value = resolveExposureAliases(raw);
  const { type } = value;
  const isHttp =
    typeof value["url"] === "string" &&
    (type === undefined || type === "http" || type === "streamable-http");
  const isStdio = typeof value["command"] === "string" && (type === undefined || type === "stdio");
  const error =
    checkCommonFields(value) ??
    (isHttp ? checkHttpServer(value, value["url"] as string) : undefined) ??
    (!isHttp && isStdio ? checkStdioServer(value) : undefined);
  if (error !== undefined && error !== "") return `server "${name}": ${error}`;
  if (isHttp) return value as unknown as mcpServersTypes.McpHttpServerConfig;
  if (isStdio) return value as unknown as mcpServersTypes.McpStdioServerConfig;
  return `server "${name}" needs either "command" (stdio) or "url" (streamable HTTP)`;
}

const mcpServerConfigValidation = { isLoopbackRedirectUri, validateMcpServerConfig };

export default mcpServerConfigValidation;

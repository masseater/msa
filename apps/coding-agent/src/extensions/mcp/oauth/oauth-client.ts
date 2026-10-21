import type mcpTypes from "@msa/mcp/index.types";
import oauth from "@msa/mcp/oauth";
import type oauthTypes from "@msa/mcp/oauth.types";

import config from "../../../config.ts";
import platformNode from "../../../core/platform-node.ts";
import type oauthInternalTypes from "../oauth-internal.types.ts";
import type oauthTypesNs from "../oauth.types.ts";

const { sha256Hex } = platformNode;
const { McpOAuthProvider } = oauth;
const { APP_NAME } = config;

const CALLBACK_HOST = "127.0.0.1";

const CALLBACK_PATH = "/callback";

const CLIENT_METADATA_BASE_URL = "https://pi.dev/oauth";

const FALLBACK_REDIRECT_URL = `http://${CALLBACK_HOST}${CALLBACK_PATH}`;

const REFRESH_SKEW_MS = 30_000;

const OAUTH_REQUEST_TIMEOUT_MS = 15_000;

function callbackSettings(
  settings: oauthTypesNs.McpOAuthSettings,
): oauthInternalTypes.CallbackSettings {
  const url = new URL(settings.callbackUrl ?? `http://${CALLBACK_HOST}${CALLBACK_PATH}`);
  const address = url.hostname.replace(/^\[|\]$/gu, "");
  const port = url.port === "" ? settings.callbackPort : Number(url.port);
  let fixedRedirectUrl: string | undefined;

  if (url.port !== "") fixedRedirectUrl = settings.callbackUrl;
  else if (port !== undefined) {
    url.port = String(port);
    fixedRedirectUrl = url.href;
  }
  return {
    fixedRedirectUrl,
    host: address === "localhost" ? CALLBACK_HOST : address,
    path: url.pathname,
    port,
    redirectHost: address,
  };
}

function mergeScopes(...scopes: (string | undefined)[]): string | undefined {
  const merged = [
    ...new Set(scopes.flatMap((scope) => scope?.split(/\s+/u).filter(Boolean) ?? [])),
  ];
  return merged.length > 0 ? merged.join(" ") : undefined;
}

function timedFetch(fetch: mcpTypes.McpFetch = globalThis.fetch): mcpTypes.McpFetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS);
    return fetch(input, {
      ...init,
      signal:
        init?.signal !== undefined && init?.signal !== null
          ? AbortSignal.any([init.signal, timeout])
          : timeout,
    });
  };
}

function registeredRedirectUrls(
  client: oauthTypes.OAuthClientInformationMixed | undefined,
): string[] {
  return client !== undefined && "redirect_uris" in client ? client.redirect_uris : [];
}

function callbackId(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.hash = "";
  return Buffer.from(sha256Hex(url.href).slice(0, 18), "hex").toString("base64url");
}

function clientMetadataDocument(
  serverUrl: string,
  redirectUrl: string,
  metadata: oauthTypes.AuthorizationServerMetadata | undefined,
): oauthTypes.OAuthClientMetadataDocument {
  if (
    metadata?.client_id_metadata_document_supported !== true ||
    metadata.token_endpoint_auth_methods_supported?.includes("none") !== true
  ) {
    throw new Error(
      'The authorization server does not support Client ID Metadata Documents for public clients; remove oauth.clientRegistration "cimd"',
    );
  }
  if (metadata.authorization_response_iss_parameter_supported === true) {
    return { redirectUrl, url: `${CLIENT_METADATA_BASE_URL}/client.json` };
  }
  const id = callbackId(serverUrl);
  const redirect = new URL(redirectUrl);
  redirect.pathname = `${CALLBACK_PATH}/${id}`;
  return { redirectUrl: redirect.href, url: `${CLIENT_METADATA_BASE_URL}/${id}/client.json` };
}

function createProvider(
  serverUrl: string,
  store: oauthTypes.McpOAuthStateStore,
  settings: oauthTypesNs.McpOAuthSettings,
  redirectUrl: string,
  onRedirect: (url: URL) => void,
): oauthTypes.McpOAuthProvider {
  return new McpOAuthProvider({
    clientMetadata: { client_name: settings.clientName ?? APP_NAME },
    redirectUrl,
    serverUrl,
    ...(settings.clientRegistration === "cimd"
      ? {
          clientMetadataDocument: (metadata: oauthTypes.AuthorizationServerMetadata | undefined) =>
            clientMetadataDocument(serverUrl, redirectUrl, metadata),
        }
      : {}),
    ...(settings.clientId === undefined ? {} : { clientId: settings.clientId }),
    ...(settings.clientSecret === undefined ? {} : { clientSecret: settings.clientSecret }),
    onRedirect,
    store,
  });
}

const oauthClient = {
  CALLBACK_PATH,
  FALLBACK_REDIRECT_URL,
  REFRESH_SKEW_MS,
  callbackId,
  callbackSettings,
  createProvider,
  mergeScopes,
  registeredRedirectUrls,
  timedFetch,
};

export default oauthClient;

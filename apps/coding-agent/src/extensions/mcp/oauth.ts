import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { oauthErrorHtml, oauthSuccessHtml } from "@msa/ai/utils/oauth-page";
import { type AuthProvider, type McpFetch, toPromise } from "@msa/mcp";
import {
  type AuthorizationServerMetadata,
  authorizeMcp,
  McpOAuthAuthorizationRequiredError,
  McpOAuthProvider,
  type McpOAuthState,
  type McpOAuthStateStore,
  type OAuthCallback,
  type OAuthCallbackPage,
  OAuthCallbackServer,
  type OAuthChallenge,
  type OAuthClientInformationMixed,
  type OAuthClientMetadataDocument,
  parseWwwAuthenticate,
  stepUpScope,
} from "@msa/mcp/oauth";
import lockfile from "proper-lockfile";

import { APP_NAME, getAgentDir } from "../../config.ts";
import { type AuthStorageBackend, FileAuthStorageBackend } from "../../core/auth-storage.ts";
import { mcpNamespace } from "../../core/mcp-servers.ts";

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PATH = "/callback";

const CLIENT_METADATA_BASE_URL = "https://pi.dev/oauth";

const FALLBACK_REDIRECT_URL = `http://${CALLBACK_HOST}${CALLBACK_PATH}`;

const REFRESH_SKEW_MS = 30_000;

const OAUTH_REQUEST_TIMEOUT_MS = 15_000;

const REFRESH_LOCK_STALE_MS = 20_000;

const REFRESH_LOCK_WAIT_MS = 25_000;
const REFRESH_LOCK_RETRY_MS = 100;

export interface McpOAuthSettings {
  clientId?: string | undefined;

  clientSecret?: string | undefined;
  callbackPort?: number | undefined;

  callbackUrl?: string | undefined;

  scope?: string | undefined;

  clientName?: string | undefined;

  clientRegistration?: "dcr" | "cimd" | undefined;

  authServerMetadataUrl?: URL | undefined;
}

interface CallbackSettings {
  host: string;

  redirectHost: string;
  port: number | undefined;
  path: string;

  fixedRedirectUrl: string | undefined;
}

function callbackSettings(settings: McpOAuthSettings): CallbackSettings {
  const url = new URL(settings.callbackUrl ?? `http://${CALLBACK_HOST}${CALLBACK_PATH}`);
  const address = url.hostname.replace(/^\[|\]$/g, "");
  const port = url.port ? Number(url.port) : settings.callbackPort;
  let fixedRedirectUrl: string | undefined;

  if (url.port) fixedRedirectUrl = settings.callbackUrl;
  else if (port !== undefined) {
    url.port = String(port);
    fixedRedirectUrl = url.href;
  }
  return {
    host: address === "localhost" ? CALLBACK_HOST : address,
    redirectHost: address,
    port,
    path: url.pathname,
    fixedRedirectUrl,
  };
}

function mergeScopes(...scopes: (string | undefined)[]): string | undefined {
  const merged = [...new Set(scopes.flatMap((scope) => scope?.split(/\s+/).filter(Boolean) ?? []))];
  return merged.length > 0 ? merged.join(" ") : undefined;
}

type StoredStates = Record<string, McpOAuthState>;

function parseStates(content: string | undefined): StoredStates {
  if (!content?.trim()) return {};
  const parsed: unknown = JSON.parse(content);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as StoredStates)
    : {};
}

function serializeStates(states: StoredStates): string {
  return `${JSON.stringify(states, null, 2)}\n`;
}

function storeKeys(name: string, serverUrl: string): { key: string; legacyKey: string } {
  const legacyKey = String(new URL(serverUrl));
  return { key: `${mcpNamespace(name)}|${legacyKey}`, legacyKey };
}

export interface McpOAuthServerStore extends McpOAuthStateStore {
  withRefreshLock<T>(fn: () => Promise<T>): Promise<T>;
}

export class McpOAuthCredentialStore {
  private readonly backend: AuthStorageBackend;

  private readonly lockDir: string | undefined;

  constructor(backend?: AuthStorageBackend, lockDir?: string) {
    this.backend = backend ?? new FileAuthStorageBackend(join(getAgentDir(), "mcp-auth.json"));
    this.lockDir = backend ? lockDir : getAgentDir();
  }

  forServer(name: string, serverUrl: string): McpOAuthServerStore {
    const { key, legacyKey } = storeKeys(name, serverUrl);
    return {
      load: () =>
        this.backend.withLock((current) => {
          const states = parseStates(current);
          if (states[key] || !states[legacyKey]) return { result: states[key] };
          states[key] = states[legacyKey];
          delete states[legacyKey];
          return { result: states[key], next: serializeStates(states) };
        }),
      save: (state) =>
        this.write((states) => {
          states[key] = state;
        }),
      withRefreshLock: (fn) => this.withRefreshLock(key, fn),
    };
  }

  private async withRefreshLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (!this.lockDir) return fn();
    mkdirSync(this.lockDir, { recursive: true, mode: 0o700 });
    const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
    const release = await lockfile.lock(join(this.lockDir, `mcp-auth-refresh-${hash}`), {
      realpath: false,
      stale: REFRESH_LOCK_STALE_MS,
      retries: {
        retries: REFRESH_LOCK_WAIT_MS / REFRESH_LOCK_RETRY_MS,
        factor: 1,
        minTimeout: REFRESH_LOCK_RETRY_MS,
        maxTimeout: REFRESH_LOCK_RETRY_MS,
      },

      onCompromised: () => {},
    });
    try {
      return await fn();
    } finally {
      await release().catch(() => undefined);
    }
  }

  tokens(name: string, serverUrl: string): McpOAuthState["tokens"] {
    const { key, legacyKey } = storeKeys(name, serverUrl);
    const states = this.backend.withLock((current) => ({ result: parseStates(current) }));
    return (states[key] ?? states[legacyKey])?.tokens;
  }

  remove(name: string, serverUrl: string): boolean {
    const { key, legacyKey } = storeKeys(name, serverUrl);
    return this.backend.withLock((current) => {
      const states = parseStates(current);
      const stored = key in states ? key : legacyKey in states ? legacyKey : undefined;
      if (!stored) return { result: false };
      delete states[stored];
      return { result: true, next: serializeStates(states) };
    });
  }

  private write(update: (states: StoredStates) => void): void {
    this.backend.withLock((current) => {
      const states = parseStates(current);
      update(states);
      return { result: undefined, next: serializeStates(states) };
    });
  }
}

function timedFetch(fetch: McpFetch = globalThis.fetch): McpFetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS);
    return fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  };
}

function registeredRedirectUrls(client: OAuthClientInformationMixed | undefined): string[] {
  return client && "redirect_uris" in client ? client.redirect_uris : [];
}

function callbackId(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.hash = "";
  return createHash("sha256").update(url.href).digest().subarray(0, 9).toString("base64url");
}

function clientMetadataDocument(
  serverUrl: string,
  redirectUrl: string,
  metadata: AuthorizationServerMetadata | undefined,
): OAuthClientMetadataDocument {
  if (
    !metadata?.client_id_metadata_document_supported ||
    !metadata.token_endpoint_auth_methods_supported?.includes("none")
  ) {
    throw new Error(
      'The authorization server does not support Client ID Metadata Documents for public clients; remove oauth.clientRegistration "cimd"',
    );
  }
  if (metadata.authorization_response_iss_parameter_supported) {
    return { url: `${CLIENT_METADATA_BASE_URL}/client.json`, redirectUrl };
  }
  const id = callbackId(serverUrl);
  const redirect = new URL(redirectUrl);
  redirect.pathname = `${CALLBACK_PATH}/${id}`;
  return { url: `${CLIENT_METADATA_BASE_URL}/${id}/client.json`, redirectUrl: redirect.href };
}

function createProvider(
  serverUrl: string,
  store: McpOAuthStateStore,
  settings: McpOAuthSettings,
  redirectUrl: string,
  onRedirect: (url: URL) => void,
): McpOAuthProvider {
  return new McpOAuthProvider({
    serverUrl,
    redirectUrl,
    clientMetadata: { client_name: settings.clientName ?? APP_NAME },
    ...(settings.clientRegistration === "cimd"
      ? {
          clientMetadataDocument: (metadata: AuthorizationServerMetadata | undefined) =>
            clientMetadataDocument(serverUrl, redirectUrl, metadata),
        }
      : {}),
    ...(settings.clientId === undefined ? {} : { clientId: settings.clientId }),
    ...(settings.clientSecret === undefined ? {} : { clientSecret: settings.clientSecret }),
    store,
    onRedirect,
  });
}

export interface McpAuthProvider extends AuthProvider {
  settled(): Promise<void>;
}

export function createMcpAuthProvider(options: {
  serverUrl: string;
  store: McpOAuthServerStore;
  settings: () => McpOAuthSettings;
  onChallenge: (challenge: OAuthChallenge) => void;
}): McpAuthProvider {
  const { serverUrl, store } = options;
  let refreshing: Promise<void> | undefined;

  const refresh = (
    staleToken: string | undefined,
    fetch: McpFetch = globalThis.fetch,
    challenge?: OAuthChallenge,
  ) => {
    refreshing ??= store
      .withRefreshLock(async () => {
        const state = await store.load();
        if (state?.tokens?.access_token !== staleToken) return;
        if (!state?.tokens?.refresh_token) throw new McpOAuthAuthorizationRequiredError();
        const settings = options.settings();
        const redirectUrl =
          callbackSettings(settings).fixedRedirectUrl ??
          registeredRedirectUrls(state.clientInformation)[0] ??
          FALLBACK_REDIRECT_URL;
        const provider = createProvider(serverUrl, store, settings, redirectUrl, () => {});

        const resourceMetadataUrl = challenge?.resourceMetadataUrl;
        const authorizationServerMetadataUrl = settings.authServerMetadataUrl;
        const scope = challenge?.scope;
        const result = await toPromise(
          authorizeMcp(provider, {
            serverUrl,
            ...(resourceMetadataUrl ? { resourceMetadataUrl } : {}),
            ...(authorizationServerMetadataUrl ? { authorizationServerMetadataUrl } : {}),
            ...(scope === undefined ? {} : { scope }),
            fetch: timedFetch(fetch),
          }),
        );
        if (result === "REDIRECT") throw new McpOAuthAuthorizationRequiredError();
      })
      .finally(() => {
        refreshing = undefined;
      });
    return refreshing;
  };

  return {
    token: async () => {
      await refreshing?.catch(() => undefined);
      const state = await store.load();
      const token = state?.tokens?.access_token;
      const expired =
        state?.tokensExpireAt !== undefined && state.tokensExpireAt - REFRESH_SKEW_MS <= Date.now();
      if (!expired || !state?.tokens?.refresh_token) return token;

      await refresh(token).catch(() => undefined);
      return (await store.load())?.tokens?.access_token;
    },
    onUnauthorized: async (context) => {
      const challenge = parseWwwAuthenticate(context.response.headers.get("www-authenticate"));
      options.onChallenge(challenge);

      if (challenge.error === "insufficient_scope") throw new McpOAuthAuthorizationRequiredError();
      await refresh(context.token, context.fetch, challenge);
    },
    settled: async () => {
      await refreshing?.catch(() => undefined);
    },
  };
}

export interface McpSignInPrompt {
  showAuthorizationUrl(url: URL): void;

  promptForRedirectUrl(signal: AbortSignal): Promise<string | undefined>;
}

export class McpSignInCancelledError extends Error {
  constructor() {
    super("Sign-in cancelled");
    this.name = "McpSignInCancelledError";
  }
}

type AuthorizationResponse = Pick<OAuthCallback, "code" | "iss">;

function responseFromRedirectUrl(
  input: string,
  state: string,
  redirectUrl: URL,
): AuthorizationResponse {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Expected the full redirect URL from the browser address bar");
  }

  if (url.origin !== redirectUrl.origin || url.pathname !== redirectUrl.pathname) {
    throw new Error("The redirect URL does not match this sign-in's redirect URI");
  }
  const error = url.searchParams.get("error");
  if (error) throw new Error(url.searchParams.get("error_description") ?? error);
  if (url.searchParams.get("state") !== state)
    throw new Error("The redirect URL belongs to a different sign-in");
  const code = url.searchParams.get("code");
  if (!code) throw new Error("The redirect URL does not contain an authorization code");
  const iss = url.searchParams.get("iss");
  return { code, ...(iss === null ? {} : { iss }) };
}

async function waitForAuthorizationResponse(
  callback: OAuthCallbackServer,
  state: string,
  redirectUrl: URL,
  prompt: McpSignInPrompt,
  signal: AbortSignal | undefined,
): Promise<AuthorizationResponse> {
  const controller = new AbortController();
  const promptSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  const fromBrowser = callback.waitForCallback(state, redirectUrl.pathname);
  const fromUser = prompt.promptForRedirectUrl(promptSignal).then((input) => {
    if (!input?.trim()) throw new McpSignInCancelledError();
    return responseFromRedirectUrl(input, state, redirectUrl);
  });
  try {
    return await Promise.race([fromBrowser, fromUser]);
  } finally {
    controller.abort();
    fromBrowser.catch(() => undefined);
    fromUser.catch(() => undefined);
  }
}

async function listenForCallback(
  settings: CallbackSettings,
  extraPaths: string[],
  port: number | undefined,
  required: boolean,
): Promise<OAuthCallbackServer> {
  const options = {
    host: settings.host,
    redirectHost: settings.redirectHost,
    path: settings.path,
    extraPaths,
    renderPage: (page: OAuthCallbackPage) =>
      page.ok
        ? oauthSuccessHtml("Signed in to the MCP server. You may now close this page.")
        : oauthErrorHtml(page.message, page.details),
  };
  try {
    return await OAuthCallbackServer.listen({ ...options, port: port ?? 0 });
  } catch (error) {
    if (required || port === undefined) throw error;
    return OAuthCallbackServer.listen(options);
  }
}

export async function signInMcpServer(options: {
  serverUrl: string;
  store: McpOAuthStateStore;
  settings: McpOAuthSettings;
  challenge?: OAuthChallenge | undefined;
  prompt: McpSignInPrompt;
  signal?: AbortSignal | undefined;
}): Promise<void> {
  const { serverUrl, store, settings, signal } = options;
  if (signal?.aborted) throw new McpSignInCancelledError();
  const stored = await store.load();
  const stepUp = options.challenge?.error === "insufficient_scope";
  const callbackOptions = callbackSettings(settings);

  const registered = registeredRedirectUrls(stored?.clientInformation)[0];
  const preferredPort =
    callbackOptions.port ??
    (registered ? Number(new URL(registered).port) || undefined : undefined);
  const cimd = settings.clientRegistration === "cimd";
  const callback = await listenForCallback(
    callbackOptions,

    cimd ? [`${CALLBACK_PATH}/${callbackId(serverUrl)}`] : [],
    preferredPort,
    callbackOptions.port !== undefined,
  );
  const redirectUrl = callbackOptions.fixedRedirectUrl ?? callback.redirectUrl;
  try {
    if (stored) {
      const next: McpOAuthState = { ...stored };

      delete next.oauthState;

      const keepClient =
        settings.clientId ||
        (cimd
          ? !stored.clientInformation
          : registeredRedirectUrls(stored.clientInformation).includes(redirectUrl));
      if (!keepClient) {
        delete next.clientInformation;
        delete next.tokens;
        delete next.tokensExpireAt;
      }
      await store.save(next);
    }

    let authorizationUrl: URL | undefined;
    const provider = createProvider(serverUrl, store, settings, redirectUrl, (url) => {
      authorizationUrl = url;
    });
    const resourceMetadataUrl = options.challenge?.resourceMetadataUrl;
    const authorizationServerMetadataUrl = settings.authServerMetadataUrl;

    const scope = mergeScopes(
      settings.scope,
      stepUp
        ? stepUpScope(stored?.tokens?.scope, options.challenge?.scope)
        : options.challenge?.scope,
    );
    const flow = {
      serverUrl,
      fetch: timedFetch(),
      ...(signal ? { signal } : {}),
      ...(resourceMetadataUrl ? { resourceMetadataUrl } : {}),
      ...(authorizationServerMetadataUrl ? { authorizationServerMetadataUrl } : {}),
      ...(scope === undefined ? {} : { scope }),
    };

    const skipRefresh = stepUp;
    if ((await toPromise(authorizeMcp(provider, { ...flow, skipRefresh }))) === "AUTHORIZED")
      return;
    if (!authorizationUrl) throw new Error("OAuth flow did not produce an authorization URL");

    const state = await provider.state();

    const authorizationRedirectUrl = new URL(
      authorizationUrl.searchParams.get("redirect_uri") ?? redirectUrl,
    );
    options.prompt.showAuthorizationUrl(authorizationUrl);
    const { code, iss } = await waitForAuthorizationResponse(
      callback,
      state,
      authorizationRedirectUrl,
      options.prompt,
      signal,
    );
    await toPromise(
      authorizeMcp(provider, {
        ...flow,
        authorizationCode: code,
        ...(iss === undefined ? {} : { iss }),
      }),
    );
  } catch (error) {
    if (signal?.aborted) throw new McpSignInCancelledError();
    throw error;
  } finally {
    await callback.close();
  }
}

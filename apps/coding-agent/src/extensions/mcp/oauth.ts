import oauthPage from "@msa/ai/utils/oauth-page";
import mcp from "@msa/mcp";
import type mcpTypes from "@msa/mcp/index.types";
import oauth from "@msa/mcp/oauth";
import type oauthTypes from "@msa/mcp/oauth.types";
import * as Effect from "effect/Effect";
import lockfile from "proper-lockfile";

import { APP_NAME, getAgentDir } from "../../config.ts";
import { type AuthStorageBackend, FileAuthStorageBackend } from "../../core/auth-storage.ts";
import { awaited, awaiting, awaitingWith } from "../../core/awaiting.ts";
import { mcpNamespace } from "../../core/mcp-servers.ts";
import { join, sha256Hex } from "../../core/platform-node.ts";
import { nowMs } from "../../core/platform.ts";
import { makeDirectory } from "../../utils/node-fs.ts";
import { McpSignInCancelledError } from "./sign-in-cancelled.ts";

const { oauthErrorHtml, oauthSuccessHtml } = oauthPage;

const {
  McpOAuthAuthorizationRequiredError,
  McpOAuthProvider,
  OAuthCallbackServer,
  authorizeMcp,
  parseWwwAuthenticate,
  stepUpScope,
} = oauth;
const { toPromise } = mcp;

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

type StoredStates = Record<string, oauthTypes.McpOAuthState>;

function parseStates(content: string | undefined): StoredStates {
  if (content === undefined || content.trim() === "") return {};
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

export interface McpOAuthServerStore extends oauthTypes.McpOAuthStateStore {
  withRefreshLock<T>(fn: () => Promise<T>): Promise<T>;
}

export class McpOAuthCredentialStore {
  private readonly backend: AuthStorageBackend;

  private readonly lockDir: string | undefined;

  constructor(backend?: AuthStorageBackend, lockDir?: string) {
    this.backend = backend ?? new FileAuthStorageBackend(join(getAgentDir(), "mcp-auth.json"));
    this.lockDir = backend === undefined ? getAgentDir() : lockDir;
  }

  forServer(name: string, serverUrl: string): McpOAuthServerStore {
    const { key, legacyKey } = storeKeys(name, serverUrl);
    return {
      load: () =>
        this.backend.withLock((current) => {
          const states = parseStates(current);
          if (states[key] !== undefined || states[legacyKey] === undefined)
            return { result: states[key] };
          states[key] = states[legacyKey];
          delete states[legacyKey];
          return { next: serializeStates(states), result: states[key] };
        }),
      save: (state) =>
        this.write((states) => {
          states[key] = state;
        }),
      withRefreshLock: (fn) => this.withRefreshLock(key, fn),
    };
  }

  private withRefreshLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.lockDir === undefined || this.lockDir === "") return yield* awaited(fn());
        const lockDir = this.lockDir;
        yield* awaited(makeDirectory({ mode: 0o700, path: lockDir }));
        const hash = sha256Hex(key).slice(0, 16);
        const release = yield* awaited(
          lockfile.lock(join(this.lockDir, `mcp-auth-refresh-${hash}`), {
            onCompromised: () => {},
            realpath: false,
            retries: {
              factor: 1,
              maxTimeout: REFRESH_LOCK_RETRY_MS,
              minTimeout: REFRESH_LOCK_RETRY_MS,
              retries: REFRESH_LOCK_WAIT_MS / REFRESH_LOCK_RETRY_MS,
            },
            stale: REFRESH_LOCK_STALE_MS,
          }),
        );
        try {
          return yield* awaited(fn());
        } finally {
          yield* awaited(release().catch(() => undefined));
        }
      }, this),
    );
  }

  tokens(name: string, serverUrl: string): oauthTypes.McpOAuthState["tokens"] {
    const { key, legacyKey } = storeKeys(name, serverUrl);
    const states = this.backend.withLock((current) => ({ result: parseStates(current) }));
    return (states[key] ?? states[legacyKey])?.tokens;
  }

  remove(name: string, serverUrl: string): boolean {
    const { key, legacyKey } = storeKeys(name, serverUrl);
    return this.backend.withLock((current) => {
      const states = parseStates(current);
      const stored = key in states ? key : legacyKey in states ? legacyKey : undefined;
      if (stored === undefined || stored === "") return { result: false };
      delete states[stored];
      return { next: serializeStates(states), result: true };
    });
  }

  private write(update: (states: StoredStates) => void): void {
    this.backend.withLock((current) => {
      const states = parseStates(current);
      update(states);
      return { next: serializeStates(states), result: undefined };
    });
  }
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
  settings: McpOAuthSettings,
  redirectUrl: string,
  onRedirect: (url: URL) => void,
): oauthTypes.McpOAuthProvider {
  return new McpOAuthProvider({
    serverUrl,
    redirectUrl,
    clientMetadata: { client_name: settings.clientName ?? APP_NAME },
    ...(settings.clientRegistration === "cimd"
      ? {
          clientMetadataDocument: (metadata: oauthTypes.AuthorizationServerMetadata | undefined) =>
            clientMetadataDocument(serverUrl, redirectUrl, metadata),
        }
      : {}),
    ...(settings.clientId === undefined ? {} : { clientId: settings.clientId }),
    ...(settings.clientSecret === undefined ? {} : { clientSecret: settings.clientSecret }),
    store,
    onRedirect,
  });
}

export interface McpAuthProvider extends mcpTypes.AuthProvider {
  settled(): Promise<void>;
}

export function createMcpAuthProvider(options: {
  serverUrl: string;
  store: McpOAuthServerStore;
  settings: () => McpOAuthSettings;
  onChallenge: (challenge: oauthTypes.OAuthChallenge) => void;
}): McpAuthProvider {
  const { serverUrl, store } = options;
  let refreshing: Promise<void> | undefined;

  const refresh = (
    staleToken: string | undefined,
    fetch: mcpTypes.McpFetch = globalThis.fetch,
    challenge?: oauthTypes.OAuthChallenge,
  ) => {
    refreshing ??= store
      .withRefreshLock(() =>
        Effect.runPromise(
          awaiting(function* () {
            const state = yield* awaited(store.load());
            if (state?.tokens?.access_token !== staleToken) return;
            if (state?.tokens?.refresh_token === undefined || state?.tokens?.refresh_token === "")
              throw new McpOAuthAuthorizationRequiredError();
            const settings = options.settings();
            const redirectUrl =
              callbackSettings(settings).fixedRedirectUrl ??
              registeredRedirectUrls(state.clientInformation)[0] ??
              FALLBACK_REDIRECT_URL;
            const provider = createProvider(serverUrl, store, settings, redirectUrl, () => {});

            const resourceMetadataUrl = challenge?.resourceMetadataUrl;
            const authorizationServerMetadataUrl = settings.authServerMetadataUrl;
            const scope = challenge?.scope;
            const result = yield* awaited(
              authorizeMcp(provider, {
                serverUrl,
                ...(resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl }),
                ...(authorizationServerMetadataUrl === undefined
                  ? {}
                  : { authorizationServerMetadataUrl }),
                ...(scope === undefined ? {} : { scope }),
                fetch: timedFetch(fetch),
              }).pipe(toPromise),
            );
            if (result === "REDIRECT") throw new McpOAuthAuthorizationRequiredError();
          }),
        ),
      )
      .finally(() => {
        refreshing = undefined;
      });
    return refreshing;
  };

  return {
    onUnauthorized: (context) =>
      Effect.runPromise(
        awaiting(function* () {
          const challenge = parseWwwAuthenticate(context.response.headers.get("www-authenticate"));
          options.onChallenge(challenge);

          if (challenge.error === "insufficient_scope")
            throw new McpOAuthAuthorizationRequiredError();
          yield* awaited(refresh(context.token, context.fetch, challenge));
        }),
      ),
    settled: () =>
      Effect.runPromise(
        awaiting(function* () {
          yield* awaited(refreshing?.catch(() => undefined));
        }),
      ),
    token: () =>
      Effect.runPromise(
        awaiting(function* () {
          yield* awaited(refreshing?.catch(() => undefined));
          const state = yield* awaited(store.load());
          const token = state?.tokens?.access_token;
          const expired =
            state?.tokensExpireAt !== undefined &&
            state.tokensExpireAt - REFRESH_SKEW_MS <= nowMs();
          if (
            !expired ||
            state?.tokens?.refresh_token === undefined ||
            state?.tokens?.refresh_token === ""
          )
            return token;

          yield* awaited(refresh(token).catch(() => undefined));
          return (yield* awaited(store.load()))?.tokens?.access_token;
        }),
      ),
  };
}

export interface McpSignInPrompt {
  showAuthorizationUrl(url: URL): void;

  promptForRedirectUrl(signal: AbortSignal): Promise<string | undefined>;
}

export { McpSignInCancelledError } from "./sign-in-cancelled.ts";

type AuthorizationResponse = Pick<oauthTypes.OAuthCallback, "code" | "iss">;

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
  if (error !== null && error !== "")
    throw new Error(url.searchParams.get("error_description") ?? error);
  if (url.searchParams.get("state") !== state)
    throw new Error("The redirect URL belongs to a different sign-in");
  const code = url.searchParams.get("code");
  if (code === null || code === "")
    throw new Error("The redirect URL does not contain an authorization code");
  const iss = url.searchParams.get("iss");
  return { code, ...(iss === null ? {} : { iss }) };
}

function waitForAuthorizationResponse(
  callback: oauthTypes.OAuthCallbackServer,
  state: string,
  redirectUrl: URL,
  prompt: McpSignInPrompt,
  signal: AbortSignal | undefined,
): Promise<AuthorizationResponse> {
  return Effect.runPromise(
    awaiting(function* () {
      const controller = new AbortController();
      const promptSignal =
        signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]);
      const fromBrowser = callback.waitForCallback(state, redirectUrl.pathname);
      const fromUser = prompt.promptForRedirectUrl(promptSignal).then((input) => {
        if (input === undefined || input.trim() === "") throw new McpSignInCancelledError();
        return responseFromRedirectUrl(input, state, redirectUrl);
      });
      try {
        return yield* awaited(Promise.race([fromBrowser, fromUser]));
      } finally {
        controller.abort();
        fromBrowser.catch(() => undefined);
        fromUser.catch(() => undefined);
      }
    }),
  );
}

function listenForCallback(
  settings: CallbackSettings,
  extraPaths: string[],
  port: number | undefined,
  required: boolean,
): Promise<oauthTypes.OAuthCallbackServer> {
  return Effect.runPromise(
    awaiting(function* () {
      const options = {
        extraPaths,
        host: settings.host,
        path: settings.path,
        redirectHost: settings.redirectHost,
        renderPage: (page: oauthTypes.OAuthCallbackPage) =>
          page.ok
            ? oauthSuccessHtml("Signed in to the MCP server. You may now close this page.")
            : oauthErrorHtml(page.message, page.details),
      };
      try {
        return yield* awaited(OAuthCallbackServer.listen({ ...options, port: port ?? 0 }));
      } catch (error) {
        if (required || port === undefined) throw error;
        return yield* awaited(OAuthCallbackServer.listen(options));
      }
    }),
  );
}

export function signInMcpServer(options: {
  serverUrl: string;
  store: oauthTypes.McpOAuthStateStore;
  settings: McpOAuthSettings;
  challenge?: oauthTypes.OAuthChallenge | undefined;
  prompt: McpSignInPrompt;
  signal?: AbortSignal | undefined;
}): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      const { serverUrl, store, settings, signal } = options;
      if (signal?.aborted === true) throw new McpSignInCancelledError();
      const stored = yield* awaited(store.load());
      const stepUp = options.challenge?.error === "insufficient_scope";
      const callbackOptions = callbackSettings(settings);

      const registered = registeredRedirectUrls(stored?.clientInformation)[0];
      const registeredPort =
        registered !== undefined && registered !== "" ? Number(new URL(registered).port) : 0;
      const preferredPort =
        callbackOptions.port ?? (registeredPort > 0 ? registeredPort : undefined);
      const cimd = settings.clientRegistration === "cimd";
      const callback = yield* awaited(
        listenForCallback(
          callbackOptions,

          cimd ? [`${CALLBACK_PATH}/${callbackId(serverUrl)}`] : [],
          preferredPort,
          callbackOptions.port !== undefined,
        ),
      );
      const redirectUrl = callbackOptions.fixedRedirectUrl ?? callback.redirectUrl;
      try {
        if (stored !== undefined) {
          const next: oauthTypes.McpOAuthState = { ...stored };

          delete next.oauthState;

          const keepClient =
            settings.clientId ||
            (cimd
              ? stored.clientInformation === undefined
              : registeredRedirectUrls(stored.clientInformation).includes(redirectUrl));
          if (keepClient === false || keepClient === "") {
            delete next.clientInformation;
            delete next.tokens;
            delete next.tokensExpireAt;
          }
          yield* awaited(store.save(next));
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
          fetch: timedFetch(),
          serverUrl,
          ...(signal === undefined ? {} : { signal }),
          ...(resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl }),
          ...(authorizationServerMetadataUrl === undefined
            ? {}
            : { authorizationServerMetadataUrl }),
          ...(scope === undefined ? {} : { scope }),
        };

        const skipRefresh = stepUp;
        if (
          (yield* awaited(authorizeMcp(provider, { ...flow, skipRefresh }).pipe(toPromise))) ===
          "AUTHORIZED"
        )
          return;
        if (authorizationUrl === undefined)
          throw new Error("OAuth flow did not produce an authorization URL");

        const state = yield* awaited(provider.state());

        const authorizationRedirectUrl = new URL(
          authorizationUrl.searchParams.get("redirect_uri") ?? redirectUrl,
        );
        options.prompt.showAuthorizationUrl(authorizationUrl);
        const { code, iss } = yield* awaited(
          waitForAuthorizationResponse(
            callback,
            state,
            authorizationRedirectUrl,
            options.prompt,
            signal,
          ),
        );
        yield* awaited(
          authorizeMcp(provider, {
            ...flow,
            authorizationCode: code,
            ...(iss === undefined ? {} : { iss }),
          }).pipe(toPromise),
        );
      } catch (error) {
        if (signal?.aborted ?? false) throw new McpSignInCancelledError();
        throw error;
      } finally {
        yield* awaited(callback.close());
      }
    }),
  );
}

import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

import {
  type AuthProvider,
  type CallToolResult,
  JSON_RPC_ERROR_CODES,
  type ListResourcesResult,
  type ListResourceTemplatesResult,
  McpAuthRequiredError,
  McpClient,
  McpError,
  McpHttpError,
  type McpRequestOptions,
  McpSessionExpiredError,
  type Tool as McpTool,
  type McpTransport,
  type ReadResourceResult,
  type Resource,
  type ResourceTemplate,
  StdioTransport,
  StreamableHttpTransport,
} from "@msa/mcp";
import { McpOAuthAuthorizationRequiredError, type OAuthChallenge } from "@msa/mcp/oauth";
import * as Effect from "effect/Effect";

import { VERSION } from "../../config.ts";
import { awaited, awaiting, awaitingWith, performed } from "../../core/awaiting.ts";
import { basename, join, resolve } from "../../core/platform-node.ts";
import {
  resolveConfigValueOrThrow,
  resolveHeadersOrThrow,
} from "../../core/resolve-config-value.ts";
import { toErrorMessage } from "../../utils/errors.ts";
import type { McpServerEntry } from "./config.ts";
import type { McpServerLog } from "./log.ts";
import {
  createMcpAuthProvider,
  type McpAuthProvider,
  type McpOAuthCredentialStore,
  type McpOAuthSettings,
} from "./oauth.ts";
import type { McpResourceServer } from "./resources.ts";
import type { McpToolCaller } from "./tools.ts";

export { McpServerLog } from "./log.ts";
export { McpOAuthCredentialStore, McpSignInCancelledError, signInMcpServer } from "./oauth.ts";

const DEFAULT_TIMEOUT_SECONDS = 60;
const STDERR_TAIL_CHARS = 2_000;

const CONNECT_RETRY_DELAYS_MS = [250, 1_000];

type ServerState = "connecting" | "connected" | "disconnected" | "needs-auth" | "failed" | "closed";

export type McpTransportFactory = (
  entry: McpServerEntry,
  cwd: string,
  authProvider: AuthProvider | undefined,
) => McpTransport;

function isTransientError(error: unknown): boolean {
  if (error instanceof McpHttpError) {
    return (
      error.status === 408 || error.status === 429 || (error.status >= 500 && error.status !== 501)
    );
  }
  return error instanceof TypeError;
}

function signInRequiredMessage(entry: McpServerEntry): string {
  const provider = "url" in entry.config ? entry.config.auth?.provider : undefined;
  return `MCP server "${entry.name}" requires sign-in. Run ${provider !== undefined && provider !== "" ? `/login ${provider}` : "/mcp"} to sign in.`;
}

function usesOAuth(entry: McpServerEntry): boolean {
  const { config } = entry;
  if (!("url" in config) || config.auth !== undefined) return false;
  return !Object.keys(config.headers ?? {}).some(
    (header) => header.toLowerCase() === "authorization",
  );
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || (process.platform === "win32" && value.startsWith("~\\"))) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

export function createDefaultTransport(
  entry: McpServerEntry,
  cwd: string,
  authProvider: AuthProvider | undefined,
): McpTransport {
  const { config, name } = entry;
  if ("url" in config) {
    const headers = resolveHeadersOrThrow(config.headers, `MCP server "${name}"`);
    return new StreamableHttpTransport({
      url: config.url,
      ...(headers === undefined ? {} : { headers }),
      ...(authProvider === undefined ? {} : { authProvider }),
    });
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(config.env ?? {})) {
    env[key] = resolveConfigValueOrThrow(value, `MCP server "${name}" env "${key}"`);
  }
  return new StdioTransport({
    command: expandHome(config.command),
    ...(config.args === undefined ? {} : { args: config.args.map(expandHome) }),
    cwd: resolve(cwd, expandHome(config.cwd ?? ".")),
    env,
    stderr: "pipe",
  });
}

function withoutTemplates<T>(list: () => Promise<T>, empty: T): Promise<T> {
  return Effect.runPromise(
    awaiting(function* () {
      try {
        return yield* awaited(list());
      } catch (error) {
        if (error instanceof McpError && error.code === JSON_RPC_ERROR_CODES.methodNotFound)
          return empty;
        throw error;
      }
    }),
  );
}

function listTemplates(
  client: McpClient,
  options: McpRequestOptions = {},
): Promise<ResourceTemplate[]> {
  return withoutTemplates(() => client.listResourceTemplates(options), []);
}

export class McpServerConnection implements McpToolCaller, McpResourceServer {
  readonly entry: McpServerEntry;
  state: ServerState = "connecting";
  error: string | undefined;
  tools: McpTool[] = [];

  hasResources = false;

  instructions: string | undefined;

  challenge: OAuthChallenge | undefined;
  private client: McpClient | undefined;
  private opening: Promise<McpClient> | undefined;

  private readonly shutdown = new AbortController();

  private stderrTail: string | undefined;
  private readonly cwd: string;
  private readonly createTransport: McpTransportFactory;
  private readonly authProvider: McpAuthProvider | undefined;
  private readonly onTools: (connection: McpServerConnection) => void;
  private readonly onChange: ((connection: McpServerConnection) => void) | undefined;
  private readonly log: McpServerLog | undefined;

  constructor(options: {
    entry: McpServerEntry;
    cwd: string;
    createTransport: McpTransportFactory;
    credentials: McpOAuthCredentialStore;

    providerToken?: (provider: string) => Promise<string | undefined>;
    onTools: (connection: McpServerConnection) => void;

    onChange?: (connection: McpServerConnection) => void;

    log?: McpServerLog;
  }) {
    this.entry = options.entry;
    this.cwd = options.cwd;
    this.createTransport = options.createTransport;
    this.onTools = options.onTools;
    this.onChange = options.onChange;
    this.log = options.log;
    const url = this.oauthUrl;
    const provider = "url" in this.entry.config ? this.entry.config.auth?.provider : undefined;
    this.authProvider =
      url !== undefined && url !== ""
        ? createMcpAuthProvider({
            serverUrl: url,
            store: options.credentials.forServer(this.entry.name, url),
            settings: () => this.oauthSettings(),
            onChallenge: (challenge) => {
              this.challenge = challenge;
            },
          })
        : provider !== undefined && provider !== ""
          ? {
              token: () =>
                Effect.runPromise(
                  awaiting(function* () {
                    return yield* awaited(options.providerToken?.(provider));
                  }),
                ),
              settled: () => Effect.runPromise(Effect.sync(() => {})),
            }
          : undefined;
  }

  get name(): string {
    return this.entry.name;
  }

  private get closed(): boolean {
    return this.shutdown.signal.aborted;
  }

  get timeoutMs(): number {
    return (this.entry.config.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
  }

  get oauthUrl(): string | undefined {
    return usesOAuth(this.entry) && "url" in this.entry.config ? this.entry.config.url : undefined;
  }

  oauthSettings(): McpOAuthSettings {
    const oauth = "url" in this.entry.config ? this.entry.config.oauth : undefined;
    if (oauth === undefined) return {};
    return {
      clientId: oauth.clientId,
      clientSecret:
        oauth.clientSecret === undefined
          ? undefined
          : resolveConfigValueOrThrow(
              oauth.clientSecret,
              `MCP server "${this.entry.name}" oauth.clientSecret`,
            ),
      callbackPort: oauth.callbackPort,
      callbackUrl: oauth.callbackUrl,
      scope: oauth.scope,
      clientName: oauth.clientName,
      clientRegistration: oauth.clientRegistration,
      authServerMetadataUrl:
        oauth.authServerMetadataUrl !== undefined && oauth.authServerMetadataUrl !== ""
          ? new URL(oauth.authServerMetadataUrl)
          : undefined,
    };
  }

  getClient(): Promise<McpClient> {
    if (this.closed)
      return Promise.reject(new Error(`MCP server "${this.entry.name}" is shut down`));
    if (this.client?.connectionState === "connected") return Promise.resolve(this.client);
    this.opening ??= this.open().finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }

  callTool(
    name: string,
    args: Record<string, unknown>,
    options: McpRequestOptions,
  ): Promise<CallToolResult> {
    return this.withClient((client) => client.callTool(name, args, options));
  }

  readResource(uri: string, options: McpRequestOptions): Promise<ReadResourceResult> {
    return this.withClient((client) => client.readResource(uri, options), true);
  }

  resourcesPage(
    cursor: string | undefined,
    options: McpRequestOptions,
  ): Promise<ListResourcesResult> {
    return this.withClient((client) => client.listResourcesPage(cursor, options), true);
  }

  resourceTemplatesPage(
    cursor: string | undefined,
    options: McpRequestOptions,
  ): Promise<ListResourceTemplatesResult> {
    return this.withClient(
      (client) =>
        withoutTemplates(() => client.listResourceTemplatesPage(cursor, options), {
          resourceTemplates: [],
        }),
      true,
    );
  }

  allResources(options: McpRequestOptions): Promise<Resource[]> {
    return this.withClient((client) => client.listResources(options), true);
  }

  allResourceTemplates(options: McpRequestOptions): Promise<ResourceTemplate[]> {
    return this.withClient((client) => listTemplates(client, options), true);
  }

  private withClient<T>(run: (client: McpClient) => Promise<T>, readOnly = false): Promise<T> {
    return Effect.runPromise(
      awaitingWith(function* () {
        for (let attempt = 1; ; attempt++) {
          const client = yield* awaited(this.getClient());
          try {
            return yield* awaited(run(client));
          } catch (error) {
            if (
              readOnly &&
              attempt === 1 &&
              error instanceof McpHttpError &&
              isTransientError(error)
            ) {
              yield* performed(Effect.sleep(CONNECT_RETRY_DELAYS_MS[0] ?? 0));
              continue;
            }
            if (error instanceof McpSessionExpiredError && attempt === 1) {
              if (this.client === client) this.client = undefined;
              continue;
            }
            if (!this.needsSignIn(error)) throw error;
            yield* awaited(this.dropClient(client));
            this.markNeedsAuth();
            throw new Error(signInRequiredMessage(this.entry), { cause: error });
          }
        }
      }, this),
    );
  }

  reconnect(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.opening?.catch(() => undefined));
        if (this.client !== undefined) yield* awaited(this.dropClient(this.client));
        yield* awaited(this.getClient());
      }, this),
    );
  }

  signOut(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.opening?.catch(() => undefined));
        if (this.client !== undefined) yield* awaited(this.dropClient(this.client));
        if (!this.closed) this.markNeedsAuth();
      }, this),
    );
  }

  private needsSignIn(error: unknown): boolean {
    return (
      error instanceof McpOAuthAuthorizationRequiredError ||
      (this.authProvider !== undefined && error instanceof McpAuthRequiredError)
    );
  }

  private markNeedsAuth(): void {
    this.state = "needs-auth";
    this.error = undefined;
    this.changed();
  }

  private changed(): void {
    this.onChange?.(this);
  }

  private dropClient(client: McpClient): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.client === client) this.client = undefined;
        yield* awaited(client.close().catch(() => undefined));
      }, this),
    );
  }

  private open(): Promise<McpClient> {
    return Effect.runPromise(
      awaitingWith(function* () {
        this.state = "connecting";
        this.changed();
        const retries = "url" in this.entry.config ? CONNECT_RETRY_DELAYS_MS : [];
        for (let attempt = 0; ; attempt++) {
          this.stderrTail = undefined;
          try {
            return yield* awaited(this.connectOnce());
          } catch (error) {
            const delay = retries[attempt];
            if (this.closed || delay === undefined || !isTransientError(error)) {
              throw this.connectFailed(error);
            }
            yield* awaited(
              Effect.runPromise(Effect.sleep(delay), { signal: this.shutdown.signal }).catch(
                () => undefined,
              ),
            );
            if (this.closed) throw this.connectFailed(error);
          }
        }
      }, this),
    );
  }

  private connectOnce(): Promise<McpClient> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const client = new McpClient({
          name: "msa",
          version: VERSION,
          requestTimeoutMs: this.timeoutMs,
          roots: [{ uri: pathToFileURL(this.cwd).href, name: basename(this.cwd) }],
        });
        const log = this.log;
        if (log !== undefined)
          client.onNotification("notifications/message", (params) =>
            log.write(this.entry.name, params),
          );

        let closing: Promise<void> | undefined;
        const closeClient = () => {
          closing ??= client.close().catch(() => undefined);
          return closing;
        };
        this.shutdown.signal.addEventListener("abort", closeClient, { once: true });
        let transport: McpTransport | undefined;
        try {
          transport = this.createTransport(this.entry, this.cwd, this.authProvider);
          yield* awaited(client.connect(transport));
          client.onNotification("notifications/tools/list_changed", () => {
            void this.refreshTools(client);
          });
          const stdio = transport instanceof StdioTransport ? transport : undefined;
          client.onClose(() => this.handleClientClose(client, stdio));

          const tools =
            client.serverCapabilities?.tools === undefined
              ? []
              : yield* awaited(client.listTools());
          if (this.closed) throw new Error("shut down while connecting");
          if (client.connectionState !== "connected")
            throw new Error("connection closed during setup");
          this.client = client;
          this.tools = tools;
          this.hasResources = client.serverCapabilities?.resources !== undefined;
          this.instructions = client.instructions?.trim() || undefined;
          this.state = "connected";
          this.error = undefined;
          this.onTools(this);
          this.changed();
          return client;
        } catch (error) {
          yield* awaited(closeClient());
          if (transport instanceof StdioTransport) {
            this.stderrTail = transport.stderr.trim().slice(-STDERR_TAIL_CHARS) || undefined;
          }
          throw error;
        } finally {
          this.shutdown.signal.removeEventListener("abort", closeClient);
        }
      }, this),
    );
  }

  private connectFailed(error: unknown): Error {
    if (this.needsSignIn(error) && !this.closed) {
      this.markNeedsAuth();
      return new Error(signInRequiredMessage(this.entry));
    }
    this.state = this.closed ? "closed" : "failed";
    this.error =
      this.stderrTail !== undefined && this.stderrTail !== ""
        ? `${toErrorMessage(error)}\n${this.stderrTail}`
        : toErrorMessage(error);
    this.changed();
    return new Error(`MCP server "${this.entry.name}" failed to connect: ${this.error}`);
  }

  private handleClientClose(client: McpClient, stdio: StdioTransport | undefined): void {
    if (this.client !== client || this.closed) return;
    this.client = undefined;
    this.state = "disconnected";
    const stderr = stdio?.stderr.trim().slice(-STDERR_TAIL_CHARS);
    this.error =
      stderr !== undefined && stderr !== "" ? `Connection closed\n${stderr}` : "Connection closed";
    this.changed();
  }

  private refreshTools(client: McpClient): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          const tools = yield* awaited(client.listTools());
          if (this.client !== client || this.closed) return;
          this.tools = tools;
          this.onTools(this);
        } catch (error) {
          this.error = `Failed to refresh tools: ${toErrorMessage(error)}`;
        }
        this.changed();
      }, this),
    );
  }

  close(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        this.shutdown.abort();
        this.state = "closed";
        this.changed();
        const client = this.client;
        this.client = undefined;
        yield* awaited(
          Promise.all([
            client?.close().catch(() => undefined),
            this.opening?.catch(() => undefined),
          ]),
        );

        yield* awaited(this.authProvider?.settled());
      }, this),
    );
  }
}

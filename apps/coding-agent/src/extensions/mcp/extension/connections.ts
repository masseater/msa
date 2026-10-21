import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import srcConfig from "../../../config.ts";
import awaitingModule from "../../../core/awaiting.ts";
import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import platformNode from "../../../core/platform-node.ts";
import interop from "../../../utils/interop.ts";
import type extensionInternalTypes from "../extension-internal.types.ts";
import extensionPart1 from "../extension-part1.ts";
import type oauthTypesNs from "../oauth.types.ts";
import runtimeLazy from "../runtime.lazy.ts";
import type McpRuntime from "../runtime.ts";
import type runtimeTypes from "../runtime.types.ts";
import type McpExtensionHost from "./host.ts";

const { describeState, hasDirectTools, isEnabled } = extensionPart1;
const { awaited, awaitingWith, performed } = awaitingModule;
const { loadMcpRuntime } = runtimeLazy;
const { callbackPromise } = interop;

const { join } = platformNode;
const { getAgentDir } = srcConfig;

export default class McpConnections {
  private readonly host: McpExtensionHost;

  constructor(host: McpExtensionHost) {
    this.host = host;
  }

  readonly tokensAtSignIn = new Map<runtimeTypes.McpServerConnection, string>();

  readonly storedTokens = (connection: runtimeTypes.McpServerConnection): string => {
    const url = connection.auth.oauthUrl;
    return url !== undefined && url !== "" && this.host.credentials !== undefined
      ? JSON.stringify(this.host.credentials.tokens(connection.name, url) ?? null)
      : "null";
  };

  readonly onConnectionChange = (connection: runtimeTypes.McpServerConnection) => {
    if (connection.state !== "needs-auth") this.tokensAtSignIn.delete(connection);
    else if (!this.tokensAtSignIn.has(connection))
      this.tokensAtSignIn.set(connection, this.storedTokens(connection));
    this.host.emitChange();
  };

  readonly reconnectSignedIn = (ctx: extensionsTypesTypes.ExtensionContext) =>
    Effect.runPromise(
      awaitingWith(function* () {
        const signedIn = [...this.tokensAtSignIn].filter(
          ([connection, tokens]) => this.storedTokens(connection) !== tokens,
        );
        if (signedIn.length === 0) return;
        for (const [connection] of signedIn) this.tokensAtSignIn.delete(connection);
        yield* awaited(Promise.allSettled(signedIn.map(([connection]) => connection.reconnect())));
        this.host.tools.ensureDiscoveryActive(ctx);
      }, this),
    );

  readonly createConnection = (
    server: extensionInternalTypes.McpServer,
    isCurrent: () => boolean,
  ): Promise<runtimeTypes.McpServerConnection | undefined> =>
    Effect.runPromise(
      awaitingWith(function* () {
        const runtime = yield* awaited(loadMcpRuntime());
        if (!isCurrent()) return undefined;
        const connection = new runtime.McpServerConnection({
          createTransport: this.host.options.createTransport ?? runtime.createDefaultTransport,
          credentials: this.getCredentials(runtime),
          cwd: this.host.sessionCwd,
          entry: server.entry,
          log: this.getServerLog(runtime),
          onChange: (serverConnection) => {
            if (isCurrent()) this.onConnectionChange(serverConnection);
            else this.tokensAtSignIn.delete(serverConnection);
          },
          onTools: (serverConnection) => {
            if (isCurrent()) this.host.tools.registerTools(serverConnection);
          },
          providerToken: (provider) =>
            Effect.runPromise(
              awaitingWith(function* () {
                return yield* awaited(this.host.modelRegistry?.getApiKeyForProvider(provider));
              }, this),
            ),
        });
        server.connection = connection;
        this.host.emitChange();
        return connection;
      }, this),
    );

  readonly startConnection = (
    server: extensionInternalTypes.McpServer,
    after?: Promise<unknown>,
  ): Promise<void> => {
    const { signal } = this.host.session;
    const attempt = Symbol("connection attempt");
    server.attempt = attempt;
    const isCurrent = () =>
      !signal.aborted &&
      server.attempt === attempt &&
      isEnabled(server) &&
      this.host.servers.includes(server);
    const ready = (() =>
      Effect.runPromise(
        awaitingWith(function* () {
          yield* awaited(after);
          if (!isCurrent()) return;
          const connection = yield* awaited(this.createConnection(server, isCurrent));
          if (connection === undefined || !isCurrent()) return;
          yield* awaited(connection.getClient().catch(() => undefined));
        }, this),
      ))();
    server.ready = ready.catch(() => undefined);
    return ready;
  };

  readonly waitForServers = (
    waiting: readonly extensionInternalTypes.McpServer[],
    signal: AbortSignal | undefined,
  ) =>
    Effect.runPromise(
      awaitingWith(function* () {
        const readyOf = () =>
          waiting.flatMap((server) =>
            isEnabled(server) && this.host.servers.includes(server) && server.ready !== undefined
              ? [{ ready: server.ready, server }]
              : [],
          );
        const unchanged = (ready: ReturnType<typeof readyOf>) =>
          ready.every(
            (attempt) =>
              !isEnabled(attempt.server) ||
              !this.host.servers.includes(attempt.server) ||
              attempt.ready === attempt.server.ready,
          );
        for (;;) {
          const ready = readyOf();
          if (ready.length === 0 || signal?.aborted === true) return;
          let onAbort: (() => void) | undefined;
          yield* awaited(
            Promise.race([
              Promise.all(ready.map((attempt) => attempt.ready)),
              callbackPromise<void>((done) => {
                onAbort = () => done();
                signal?.addEventListener("abort", onAbort, { once: true });
              }),
            ]),
          );
          if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
          if ((signal?.aborted ?? false) || unchanged(ready)) return;
        }
      }, this),
    );

  readonly reportProblems = (
    ctx: extensionsTypesTypes.ExtensionContext,
    only?: readonly extensionInternalTypes.McpServer[],
  ) => {
    const lines =
      only === undefined ? this.host.configErrors.map((error) => `config: ${error}`) : [];
    for (const server of only ?? this.host.servers) {
      const state = server.connection?.state;
      if (state === "needs-auth" || state === "failed")
        lines.push(`${server.entry.name}: ${describeState(server)}`);
    }
    if (lines.length === 0) return;
    ctx.ui.notify(
      `MCP servers need attention:\n${lines.map((line) => `  ${line}`).join("\n")}\nRun /mcp to fix.`,
      "warning",
    );
  };

  readonly waitForDirectServers = (ctx: extensionsTypesTypes.ExtensionContext) =>
    Effect.runPromise(
      awaitingWith(function* () {
        if (this.host.waitedForStartup) return;
        this.host.waitedForStartup = true;
        const ready = this.host.servers.flatMap((server) =>
          isEnabled(server) && hasDirectTools(server.entry) && server.ready !== undefined
            ? [server.ready]
            : [],
        );
        if (ready.length === 0) return;
        const finished = Option.isSome(
          yield* performed(
            Effect.promise(() => Promise.all(ready)).pipe(
              Effect.timeoutOption(this.host.startupWaitMs),
            ),
          ),
        );
        if (!finished) {
          ctx.ui.notify(
            "MCP servers are still connecting; their tools become available once connected.",
            "info",
          );
        }
      }, this),
    );

  readonly getCredentials = (runtime: typeof McpRuntime): oauthTypesNs.McpOAuthCredentialStore => {
    const credentials = (this.host.credentials ??= new runtime.McpOAuthCredentialStore());
    return credentials;
  };

  readonly getServerLog = (runtime: typeof McpRuntime): runtimeTypes.McpServerLog => {
    const log = (this.host.serverLog ??= new runtime.McpServerLog(
      this.host.options.logPath ?? join(getAgentDir(), "mcp.log"),
    ));
    return log;
  };
}

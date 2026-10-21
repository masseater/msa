import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import type extensionInternalTypes from "../extension-internal.types.ts";
import runtimeLazy from "../runtime.lazy.ts";
import type runtimeTypes from "../runtime.types.ts";
import type McpExtensionHost from "./host.ts";
import McpRuntimeResources from "./runtime-resources.ts";
import serverState from "./server-state.ts";
import McpServerWaits from "./server-waits.ts";

const { describeState, isEnabled } = serverState;
const { awaited, awaitingWith } = awaitingModule;
const { loadMcpRuntime } = runtimeLazy;

export default class McpConnections {
  private readonly host: McpExtensionHost;

  readonly resources: McpRuntimeResources;

  readonly waits: McpServerWaits;

  constructor(host: McpExtensionHost) {
    this.host = host;
    this.resources = new McpRuntimeResources(host);
    this.waits = new McpServerWaits(host);
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
        this.host.tools.discovery.ensureDiscoveryActive(ctx);
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
          credentials: this.resources.getCredentials(runtime),
          cwd: this.host.sessionCwd,
          entry: server.entry,
          log: this.resources.getServerLog(runtime),
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
}

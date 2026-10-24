import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import errorsModule from "../../../utils/errors.ts";
import runtimeLazy from "../runtime.lazy.ts";
import type McpExtensionHost from "./host.ts";
import serverState from "./server-state.ts";
import serversSection from "./servers-section.ts";
import sessionConfig from "./session-config.ts";
import toolCallReach from "./tool-call-reach.ts";

const { MCP_SERVERS_SECTION, renderServersSection } = serversSection;
const { defaultLoadConfig } = sessionConfig;
const { RESOURCE_TOOL_NAMES, reachesServer } = toolCallReach;
const { isEnabled } = serverState;
const { awaited, awaitingWith } = awaitingModule;
const { loadMcpRuntime } = runtimeLazy;
const { toErrorMessage } = errorsModule;

export default class McpSessionEvents {
  private readonly host: McpExtensionHost;

  constructor(host: McpExtensionHost) {
    this.host = host;
  }

  onSessionStart(ctx: extensionsTypesTypes.ExtensionContext): Promise<void> {
    const { loadConfig } = this.host.state.options;
    return Promise.resolve(
      loadConfig === undefined
        ? defaultLoadConfig(ctx, this.host.state.msa.getSettings())
        : loadConfig(ctx),
    ).then((loaded) => this.startSession(loaded, ctx));
  }

  private startSession(
    loaded: Awaited<ReturnType<typeof defaultLoadConfig>>,
    ctx: extensionsTypesTypes.ExtensionContext,
  ): void {
    this.host.state.configErrors = loaded.errors;
    this.host.state.projectConfig = loaded.projectConfig;
    this.host.state.autoEnableCodemode = loaded.autoEnableCodemode ?? true;
    this.host.state.warnedUnreachable = false;
    this.host.state.waitedForStartup = false;
    this.host.state.sessionCwd = ctx.cwd;
    this.host.state.modelRegistry = ctx.modelRegistry;
    this.host.state.session = new AbortController();
    const { signal } = this.host.state.session;
    this.host.state.warnSignInStorage = (notice) => {
      if (signal.aborted) return;
      try {
        ctx.ui.notify(notice, "warning");
      } catch {}
    };
    this.host.state.configuredEntries = loaded.servers;
    const registered = this.host.state.registeredServers();
    this.host.state.overridden = registered.overridden;
    this.host.state.servers = [
      ...loaded.servers.map((entry) => ({ entry })),
      ...registered.servers,
    ];
    this.host.state.emitChange();

    this.host.tools.discovery.ensureDiscoveryActive(ctx);
    const enabled = this.host.state.servers.filter(isEnabled);
    if (enabled.length === 0) {
      this.host.connections.reportProblems(ctx);
      return;
    }

    const runtime = Effect.runPromise(Effect.sleep(0)).then(() => loadMcpRuntime());
    this.host.state.pending = Promise.all(
      enabled.map((server) => this.host.connections.startConnection(server, runtime)),
    )
      .then(() => {
        if (!signal.aborted) this.host.connections.reportProblems(ctx);
        return undefined;
      })
      .catch((error: unknown) => {
        try {
          ctx.ui.notify(`MCP failed to load: ${toErrorMessage(error)}`, "error");
        } catch {}
      });
  }

  onBeforeAgentStart(
    event: extensionsTypesTypes.BeforeAgentStartEvent,
    ctx: extensionsTypesTypes.ExtensionContext,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.host.connections.waits.waitForDirectServers(ctx));
        const { sections } = event.systemPromptOptions;
        const section = renderServersSection(this.host.state.servers);
        if (section !== undefined && section !== "") sections[MCP_SERVERS_SECTION] = section;
        else delete sections[MCP_SERVERS_SECTION];
      }, this),
    );
  }

  onToolCall(
    event: extensionsTypesTypes.ToolCallEvent,
    ctx: extensionsTypesTypes.ExtensionContext,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const tool = this.host.state.msa
          .getAllTools()
          .find((candidate) => candidate.name === event.toolName);
        if (tool === undefined) return;

        const readyServers = this.host.state.servers.filter(
          (server) => isEnabled(server) && server.ready,
        );
        if (readyServers.length === 0) return;
        const reach = tool.reachesTools?.(event.input);
        const owner = this.host.tools.toolOwners.get(event.toolName)?.split("\0", 1)[0];
        const waiting =
          reach === undefined
            ? RESOURCE_TOOL_NAMES.has(tool.name)
              ? readyServers
              : readyServers.filter((server) => server.entry.name === owner)
            : readyServers.filter((server) => reachesServer(reach, server.entry.name));
        yield* awaited(this.host.connections.waits.waitForServers(waiting, ctx.signal));
      }, this),
    );
  }

  onTurnStart(ctx: extensionsTypesTypes.ExtensionContext): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.host.connections.awaitingSignIn())
          yield* awaited(this.host.connections.reconnectSignedIn(ctx));
      }, this),
    );
  }

  onServersChange(ctx: extensionsTypesTypes.ExtensionContext): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const { signal } = this.host.state.session;
        if (signal.aborted) return;
        const registered = this.host.state.registeredServers();
        this.host.state.overridden = registered.overridden;
        const next = new Map(registered.servers.map((server) => [server.entry.name, server]));

        const removed = this.host.state.servers.filter(
          (server) =>
            server.entry.scope === "extension" &&
            next.get(server.entry.name)?.registeredConfig !== server.registeredConfig,
        );
        this.host.state.servers = this.host.state.servers.filter(
          (server) => !removed.includes(server),
        );
        for (const server of removed) this.host.tools.hideTools(server.entry.name);
        const added = registered.servers.filter(
          (server) => this.host.state.findServer(server.entry.name) === undefined,
        );
        this.host.state.servers.push(...added);
        this.host.state.emitChange();
        this.host.tools.discovery.ensureDiscoveryActive(ctx);
        yield* awaited(Promise.all(removed.map((server) => server.connection?.close())));
        const connecting = added.filter(isEnabled);
        if (signal.aborted || connecting.length === 0) return;
        try {
          yield* awaited(
            Promise.all(connecting.map((server) => this.host.connections.startConnection(server))),
          );
          if (signal.aborted) {
            yield* awaited(Promise.all(connecting.map((server) => server.connection?.close())));
            return;
          }
        } catch (error) {
          ctx.ui.notify(`MCP failed to load: ${toErrorMessage(error)}`, "error");
          return;
        }
        if (signal.aborted) return;
        this.host.connections.reportProblems(ctx, connecting);
      }, this),
    );
  }

  onSessionShutdown(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        this.host.state.session.abort();
        const closing = this.host.state.openConnections();
        this.host.state.servers = [];
        this.host.state.emitChange();
        yield* awaited(
          Promise.all([
            ...this.host.state.backgroundActions,
            ...closing.map((connection) => connection.close()),
          ]),
        );
      }, this),
    );
  }
}

import type tuiTypes from "@msa/tui/index.types";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { TSchema } from "typebox";

import srcConfig from "../../../config.ts";
import awaitingModule from "../../../core/awaiting.ts";
import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import mcpServers from "../../../core/mcp-servers.ts";
import type modelRegistryTypes from "../../../core/model-registry.types.ts";
import platformNode from "../../../core/platform-node.ts";
import errorsModule from "../../../utils/errors.ts";
import interop from "../../../utils/interop.ts";
import openBrowserModule from "../../../utils/open-browser.ts";
import toolModule from "../../codemode/tool.ts";
import toolSearchTool from "../../tool-search/tool.ts";
import configModule from "../config.ts";
import type configTypes from "../config.types.ts";
import type extensionInternalTypes from "../extension-internal.types.ts";
import extensionPart1 from "../extension-part1.ts";
import extensionPart2Part1 from "../extension-part2-part1.ts";
import type oauthTypesNs from "../oauth.types.ts";
import resources from "../resources.ts";
import runtimeLazy from "../runtime.lazy.ts";
import type McpRuntime from "../runtime.ts";
import type runtimeTypes from "../runtime.types.ts";
import toolsModule from "../tools.ts";
import type toolsTypes from "../tools.types.ts";
import uiModule from "../ui.ts";
import type uiTypes from "../ui.types.ts";

const {
  DEFAULT_STARTUP_WAIT_MS,
  EXPOSURE_DESCRIPTIONS,
  MCP_SERVERS_SECTION,
  MCP_USAGE,
  RESOURCE_TOOL_NAMES,
  attentionRank,
  configuredExposures,
  defaultLoadConfig,
  describeState,
  describeTransport,
  exposureOf,
  firstLine,
  hasDirectTools,
  isEnabled,
  reachesServer,
  renderServersSection,
} = extensionPart1;
const { openBrowser } = openBrowserModule;
const { getMcpToolExposure, updateMcpServerConfig } = configModule;
const { mcpNamespace } = mcpServers;
const { join, resolve } = platformNode;
const { getAgentDir } = srcConfig;
const { createMcpToolDefinition, createMcpToolName, createMcpToolRenderers } = toolsModule;
const { createMcpResourceToolDefinitions } = resources;
const { CODEMODE_TOOL_NAME } = toolModule;
const { TOOL_SEARCH_TOOL_NAME } = toolSearchTool;
const { awaited, awaiting, awaitingWith, performed } = awaitingModule;
const { loadMcpRuntime } = runtimeLazy;
const { callbackPromise } = interop;
const { toErrorMessage } = errorsModule;
const { showMcpManager } = uiModule;
const { handlerPart1 } = extensionPart2Part1;

import McpExtensionHostBase from "./host-base.ts";

function abortedController(): AbortController {
  const controller = new AbortController();
  controller.abort();
  return controller;
}

export default class McpExtensionHost extends McpExtensionHostBase {
  servers: extensionInternalTypes.McpServer[] = [];

  configuredEntries: configTypes.McpServerEntry[] = [];

  configErrors: string[] = [];

  projectConfig: string | undefined;

  overridden: string[] = [];

  autoEnableCodemode = true;

  warnedUnreachable = false;

  pending: Promise<unknown> | undefined;

  waitedForStartup = false;

  readonly startupWaitMs = this.options.startupWaitMs ?? DEFAULT_STARTUP_WAIT_MS;

  sessionCwd = process.cwd();

  credentials = this.options.credentials;

  modelRegistry: modelRegistryTypes.ModelRegistry | undefined;

  serverLog: runtimeTypes.McpServerLog | undefined;

  readonly openUrl = this.options.openUrl ?? openBrowser;

  readonly updateConfig =
    this.options.updateConfig ??
    ((entry, patch) =>
      updateMcpServerConfig(entry.override ?? entry.source, entry.name, patch, {
        override: entry.override !== undefined,
      }));

  session = abortedController();

  readonly backgroundActions = new Set<Promise<void>>();

  readonly track = <T>(work: Promise<T>): Promise<T> => {
    const task = work.then(
      () => undefined,
      () => undefined,
    );
    this.backgroundActions.add(task);
    void task.finally(() => this.backgroundActions.delete(task));
    return work;
  };

  readonly listeners = new Set<() => void>();

  readonly emitChange = () => {
    for (const listener of this.listeners) listener();
  };

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly connections = () =>
    this.servers.flatMap((server) => (server.connection === undefined ? [] : [server.connection]));

  readonly findServer = (name: string) => this.servers.find((server) => server.entry.name === name);

  readonly registeredServers = (): {
    servers: extensionInternalTypes.McpServer[];
    overridden: string[];
  } => {
    const registered: extensionInternalTypes.McpServer[] = [];
    const overriddenNames: string[] = [];
    for (const { name, config, extensionPath } of this.msa.getMcpServers()) {
      const configured = this.configuredEntries.find(
        (entry) => mcpNamespace(entry.name) === mcpNamespace(name),
      );
      if (configured !== undefined) {
        overriddenNames.push(
          `"${name}" registered by ${extensionPath} is overridden by "${configured.name}" in ${configured.source}`,
        );
        continue;
      }
      registered.push({
        entry: { config, name, scope: "extension", source: extensionPath },
        registeredConfig: JSON.stringify(config),
      });
    }
    return { overridden: overriddenNames, servers: registered };
  };

  readonly getCredentials = (runtime: typeof McpRuntime): oauthTypesNs.McpOAuthCredentialStore => {
    this.credentials ??= new runtime.McpOAuthCredentialStore();
    return this.credentials;
  };

  readonly getServerLog = (runtime: typeof McpRuntime): runtimeTypes.McpServerLog => {
    this.serverLog ??= new runtime.McpServerLog(
      this.options.logPath ?? join(getAgentDir(), "mcp.log"),
    );
    return this.serverLog;
  };

  readonly toolOwners = new Map<string, string>();

  readonly serverTools = new Map<string, Set<string>>();

  readonly definitions = new Map<
    string,
    extensionsTypesTypes.ToolDefinition<TSchema, toolsTypes.McpToolDetails>
  >();

  readonly registerTools = (connection: runtimeTypes.McpServerConnection) => {
    const server = connection.entry.name;
    const entry = this.findServer(server)?.entry ?? connection.entry;
    const description = entry.config.description?.trim();
    const namespace = {
      aliases: [server],

      name: mcpNamespace(server),
      ...(description !== undefined && description !== "" ? { description } : {}),
      ...(connection.instructions !== undefined && connection.instructions !== ""
        ? { instructions: connection.instructions }
        : {}),
    };
    const previous = this.serverTools.get(server) ?? new Set<string>();
    const current = new Set<string>();

    const plain = [...new Set(connection.tools.map((tool) => tool.name))].map((tool) =>
      createMcpToolName(server, tool),
    );
    const assignName = (tool: string, owner: string) => {
      const name = createMcpToolName(server, tool, (candidate) => {
        const existing = this.toolOwners.get(candidate);
        return (
          (existing !== undefined && existing !== owner) ||
          current.has(candidate) ||
          plain.indexOf(candidate) !== plain.lastIndexOf(candidate)
        );
      });
      this.toolOwners.set(name, owner);
      current.add(name);
      return name;
    };
    for (const tool of connection.tools) {
      const definition = createMcpToolDefinition({
        exposure: getMcpToolExposure(entry.config, tool.name),
        getClient: () =>
          Effect.runPromise(
            Effect.sync(() => {
              const resolved = this.findServer(server);
              if (resolved === undefined || !isEnabled(resolved))
                throw new Error(`MCP server "${server}" is disabled.`);
              const client = resolved.connection;
              if (client === undefined)
                throw new Error(`MCP server "${server}" is still starting.`);
              if (
                getMcpToolExposure(resolved.entry.config, tool.name) === "hidden" ||
                (client.state === "connected" &&
                  !client.tools.some((offered) => offered.name === tool.name))
              ) {
                throw new Error(`MCP tool "${server}/${tool.name}" is no longer available.`);
              }
              return client;
            }),
          ),
        name: assignName(tool.name, `${server}\0${tool.name}`),
        namespace,
        readableResources: () =>
          this.resourceServers().some((candidate) => candidate.name === server),
        server,
        timeoutMs: connection.timeoutMs,
        tool,
      });
      this.definitions.set(definition.name, definition);
      this.msa.registerTool(definition);
    }
    this.serverTools.set(server, current);

    for (const name of previous) {
      const definition = this.definitions.get(name);
      if (!current.has(name) && definition !== undefined)
        this.msa.registerTool({ ...definition, exposure: "hidden" });
    }
    this.syncResourceTools();
  };

  readonly hideTools = (server: string) => {
    for (const name of this.serverTools.get(server) ?? []) {
      const definition = this.definitions.get(name);
      if (definition !== undefined) this.msa.registerTool({ ...definition, exposure: "hidden" });
    }
    this.serverTools.set(server, new Set());
    this.syncResourceTools();
  };

  readonly serversWithResources = (): extensionInternalTypes.McpServer[] =>
    this.servers.filter(
      (server) =>
        server.connection?.hasResources &&
        isEnabled(server) &&
        exposureOf(server.entry) !== "hidden",
    );

  readonly resourceServers = (): runtimeTypes.McpServerConnection[] =>
    this.serversWithResources().flatMap((server) =>
      server.connection === undefined ? [] : [server.connection],
    );

  resourceToolsExposure: configTypes.McpExposure | undefined;

  readonly syncResourceTools = () => {
    const exposures = new Set(
      this.serversWithResources().map((server) => exposureOf(server.entry)),
    );
    const exposure = (["direct", "codemode", "deferred"] as const).find((candidate) =>
      exposures.has(candidate),
    );
    const next = exposure ?? "hidden";
    if (
      next === this.resourceToolsExposure ||
      (this.resourceToolsExposure === undefined && next === "hidden")
    )
      return;
    const wasDirect = this.resourceToolsExposure === "direct";
    this.resourceToolsExposure = next;
    const resourceDefinitions = createMcpResourceToolDefinitions({
      exposure: next,
      servers: this.resourceServers,
    });
    for (const definition of resourceDefinitions) this.msa.registerTool(definition);
    if (wasDirect) {
      const names = new Set(resourceDefinitions.map((definition) => definition.name));
      this.msa.setActiveTools(this.msa.getActiveTools().filter((name) => !names.has(name)));
    }
  };

  readonly ensureDiscoveryActive = (ctx: extensionsTypesTypes.ExtensionContext) => {
    const exposures = new Set<configTypes.McpExposure>();
    for (const server of this.servers) {
      if (isEnabled(server))
        for (const exposure of configuredExposures(server.entry)) exposures.add(exposure);
    }
    const needsCodemode = exposures.has("codemode");
    const needsToolSearch = exposures.has("deferred");
    if (!needsCodemode && !needsToolSearch) return;

    const tools = this.msa.getAllTools();
    const hasReachingTool = (name: string) =>
      tools.some((tool) => tool.name === name && tool.reachesTools);
    const hasCodemode = hasReachingTool(CODEMODE_TOOL_NAME);
    const hasToolSearch = hasReachingTool(TOOL_SEARCH_TOOL_NAME);
    const active = this.msa.getActiveTools();
    const activate: string[] = [];
    if (
      needsCodemode &&
      hasCodemode &&
      this.autoEnableCodemode &&
      !active.includes(CODEMODE_TOOL_NAME)
    ) {
      activate.push(CODEMODE_TOOL_NAME);
    }
    if (needsToolSearch && hasToolSearch && !active.includes(TOOL_SEARCH_TOOL_NAME)) {
      activate.push(TOOL_SEARCH_TOOL_NAME);
    }
    if (activate.length > 0) this.msa.setActiveTools([...active, ...activate]);
    const reachable = [...active, ...activate];
    if (hasCodemode && reachable.includes(CODEMODE_TOOL_NAME)) return;
    if (hasToolSearch && reachable.includes(TOOL_SEARCH_TOOL_NAME)) return;
    if (this.warnedUnreachable) return;
    this.warnedUnreachable = true;
    const reason =
      needsCodemode && hasCodemode && !this.autoEnableCodemode
        ? " (autoEnableCodemode is false)"
        : "";
    ctx.ui.notify(
      `MCP tools are only reachable from the codemode or tool_search tool, but neither is active${reason}; they cannot be called.`,
      "warning",
    );
  };

  readonly tokensAtSignIn = new Map<runtimeTypes.McpServerConnection, string>();

  readonly storedTokens = (connection: runtimeTypes.McpServerConnection): string => {
    const url = connection.auth.oauthUrl;
    return url !== undefined && url !== "" && this.credentials !== undefined
      ? JSON.stringify(this.credentials.tokens(connection.name, url) ?? null)
      : "null";
  };

  readonly onConnectionChange = (connection: runtimeTypes.McpServerConnection) => {
    if (connection.state !== "needs-auth") this.tokensAtSignIn.delete(connection);
    else if (!this.tokensAtSignIn.has(connection))
      this.tokensAtSignIn.set(connection, this.storedTokens(connection));
    this.emitChange();
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
        this.ensureDiscoveryActive(ctx);
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
          createTransport: this.options.createTransport ?? runtime.createDefaultTransport,
          credentials: this.getCredentials(runtime),
          cwd: this.sessionCwd,
          entry: server.entry,
          log: this.getServerLog(runtime),
          onChange: (serverConnection) => {
            if (isCurrent()) this.onConnectionChange(serverConnection);
            else this.tokensAtSignIn.delete(serverConnection);
          },
          onTools: (serverConnection) => {
            if (isCurrent()) this.registerTools(serverConnection);
          },
          providerToken: (provider) =>
            Effect.runPromise(
              awaitingWith(function* () {
                return yield* awaited(this.modelRegistry?.getApiKeyForProvider(provider));
              }, this),
            ),
        });
        server.connection = connection;
        this.emitChange();
        return connection;
      }, this),
    );

  readonly startConnection = (
    server: extensionInternalTypes.McpServer,
    after?: Promise<unknown>,
  ): Promise<void> => {
    const { signal } = this.session;
    const attempt = Symbol("connection attempt");
    server.attempt = attempt;
    const isCurrent = () =>
      !signal.aborted &&
      server.attempt === attempt &&
      isEnabled(server) &&
      this.servers.includes(server);
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
            isEnabled(server) && this.servers.includes(server) && server.ready !== undefined
              ? [{ ready: server.ready, server }]
              : [],
          );
        const unchanged = (ready: ReturnType<typeof readyOf>) =>
          ready.every(
            (attempt) =>
              !isEnabled(attempt.server) ||
              !this.servers.includes(attempt.server) ||
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
    const lines = only === undefined ? this.configErrors.map((error) => `config: ${error}`) : [];
    for (const server of only ?? this.servers) {
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

  readonly saveConfig = (
    server: extensionInternalTypes.McpServer,
    patch: configTypes.McpServerConfigPatch,
    inProject = false,
  ): string | undefined => {
    const override = inProject ? this.projectConfig : server.entry.override;
    const entry =
      override !== undefined && override !== "" ? { ...server.entry, override } : server.entry;
    if (entry.scope !== "extension") {
      try {
        this.updateConfig(entry, patch);
      } catch (error) {
        return `Could not update ${entry.override ?? entry.source}: ${toErrorMessage(error)}`;
      }
    }
    server.entry = { ...entry, config: { ...entry.config, ...patch } };
    return undefined;
  };

  readonly signIn = (
    server: extensionInternalTypes.McpServer,
    prompt: oauthTypesNs.McpSignInPrompt,
    cancel?: AbortSignal,
  ): Promise<string | undefined> =>
    Effect.runPromise(
      awaitingWith(function* () {
        const connection = server.connection;
        const url = connection?.auth.oauthUrl;
        if (connection === undefined || url === undefined || url === "")
          return `MCP server "${server.entry.name}" does not use OAuth.`;
        const runtime = yield* awaited(loadMcpRuntime());
        const signal =
          cancel === undefined
            ? this.session.signal
            : AbortSignal.any([this.session.signal, cancel]);
        try {
          yield* awaited(
            this.track(
              runtime.signInMcpServer({
                challenge: connection.auth.challenge,
                prompt,
                serverUrl: url,
                settings: connection.auth.oauthSettings(),
                signal,
                store: this.getCredentials(runtime).forServer(server.entry.name, url),
              }),
            ),
          );
        } catch (error) {
          if (error instanceof runtime.McpSignInCancelledError) return "Sign-in cancelled.";
          return `Sign-in failed: ${toErrorMessage(error)}`;
        }

        connection.auth.challenge = undefined;
        try {
          yield* awaited(connection.reconnect());
        } catch (error) {
          return `Signed in, but ${toErrorMessage(error)}`;
        }
        return undefined;
      }, this),
    );

  readonly signOut = (server: extensionInternalTypes.McpServer): Promise<boolean> =>
    Effect.runPromise(
      awaitingWith(function* () {
        const connection = server.connection;
        const url = connection?.auth.oauthUrl;
        if (connection === undefined || url === undefined || url === "") return false;
        const removed = this.getCredentials(yield* awaited(loadMcpRuntime())).remove(
          server.entry.name,
          url,
        );
        yield* awaited(connection.signOut());
        return removed;
      }, this),
    );

  readonly reconnect = (server: extensionInternalTypes.McpServer): Promise<string | undefined> =>
    Effect.runPromise(
      awaiting(function* () {
        const connection = server.connection;
        if (connection === undefined) return `MCP server "${server.entry.name}" is disabled.`;
        const previous = server.ready;
        const ready = (() =>
          Effect.runPromise(
            awaiting(function* () {
              yield* awaited(previous);
              yield* awaited(connection.reconnect());
            }),
          ))();
        server.ready = ready.catch(() => undefined);
        try {
          yield* awaited(ready);
          return undefined;
        } catch (error) {
          return toErrorMessage(error);
        }
      }),
    );

  readonly setEnabled = (
    server: extensionInternalTypes.McpServer,
    enabled: boolean,
    inProject = false,
  ): Promise<string | undefined> =>
    Effect.runPromise(
      awaitingWith(function* () {
        const failed = this.saveConfig(server, { enabled }, inProject);
        if (failed !== undefined && failed !== "") return failed;
        if (!enabled) {
          const connection = server.connection;
          server.attempt = undefined;
          server.connection = undefined;
          if (connection !== undefined) {
            server.closing = Promise.all([connection.close(), server.ready]).then(() => undefined);
          }
          const closing = server.closing;
          this.hideTools(server.entry.name);
          this.emitChange();
          try {
            yield* awaited(closing);
          } finally {
            if (server.closing === closing) server.closing = undefined;
          }
          return undefined;
        }
        yield* awaited(this.startConnection(server, server.closing));
        return undefined;
      }, this),
    );

  readonly setExposure = (
    server: extensionInternalTypes.McpServer,
    exposure: configTypes.McpExposure,
  ): string | undefined => {
    const failed = this.saveConfig(server, { exposure });
    if (failed !== undefined && failed !== "") return failed;
    if (server.connection?.state === "connected") this.registerTools(server.connection);
    this.syncResourceTools();

    const indirect = new Set(
      this.msa
        .getAllTools()
        .filter((tool) => tool.exposure !== "direct")
        .map((tool) => tool.name),
    );
    const tools = this.serverTools.get(server.entry.name) ?? new Set<string>();
    this.msa.setActiveTools(
      this.msa.getActiveTools().filter((name) => !tools.has(name) || !indirect.has(name)),
    );
    this.emitChange();
    return undefined;
  };

  readonly notices = () => [
    ...this.configErrors.map((error) => `config: ${error}`),
    ...this.overridden.map((line) => `overridden: ${line}`),
  ];

  readonly serversMenu = (): uiTypes.McpMenu => ({
    cancelLabel: "close",
    confirmLabel: "manage",
    empty: `No MCP servers configured. Add them to ${resolve(getAgentDir(), "mcp.json")} or .msa/mcp.json.`,
    error: this.notices().join("\n") || undefined,
    items: [...this.servers]
      .sort(
        (a, b) => attentionRank(a) - attentionRank(b) || a.entry.name.localeCompare(b.entry.name),
      )
      .map((server) => ({
        description: `${describeState(server)} · ${exposureOf(server.entry)} · ${server.entry.override !== undefined && server.entry.override !== "" ? "global, project override" : (server.entry.scope ?? server.entry.source)}`,
        label: server.entry.name,
        value: server.entry.name,
      })),
    title: "MCP servers",
  });

  readonly serverMenu = (name: string): uiTypes.McpMenu => {
    const server = this.findServer(name);
    if (server === undefined) {
      return {
        cancelLabel: "back",
        confirmLabel: "",
        empty: "This server is no longer configured.",
        items: [],
        title: name,
      };
    }
    const { entry, connection } = server;
    const saved =
      entry.scope === "extension"
        ? "for this session"
        : entry.override !== undefined && entry.override !== ""
          ? "saved to the project mcp.json"
          : entry.scope === undefined
            ? "saved to mcp.json"
            : `saved to the ${entry.scope} mcp.json`;

    const inProject =
      entry.scope === "global" &&
      (entry.override === undefined || entry.override === "") &&
      this.projectConfig !== undefined;
    const inProjectSaved = "saved to the project mcp.json";
    const items: tuiTypes.SelectItem[] = [];
    if (isEnabled(server)) {
      const state = connection?.state;
      if (state === "needs-auth")
        items.push({ description: "opens the browser", label: "Sign in", value: "signin" });
      if (state === "connected" && connection !== undefined) {
        items.push({
          description: `${connection.tools.length} offered`,
          label: "Tools",
          value: "tools",
        });
      }
      if (
        state === "failed" ||
        state === "disconnected" ||
        state === "connected" ||
        state === "needs-auth"
      ) {
        items.push({ label: "Reconnect", value: "reconnect" });
      }
      if (
        state === "connected" &&
        connection?.auth.oauthUrl !== undefined &&
        connection?.auth.oauthUrl !== ""
      ) {
        items.push({
          description: "deletes the stored credentials",
          label: "Sign out",
          value: "signout",
        });
      }
      items.push({ description: exposureOf(entry), label: "Exposure", value: "exposure" });
      items.push({ description: saved, label: "Disable", value: "disable" });
      if (inProject) {
        items.push({
          description: inProjectSaved,
          label: "Disable in this project",
          value: "disable-project",
        });
      }
    } else {
      items.push({ description: saved, label: "Enable", value: "enable" });
      if (inProject) {
        items.push({
          description: inProjectSaved,
          label: "Enable in this project",
          value: "enable-project",
        });
      }
    }
    const details = [
      describeTransport(entry),
      `${entry.scope ?? "config"}: ${entry.source}`,
      ...(entry.override !== undefined && entry.override !== ""
        ? [`project override: ${entry.override}`]
        : []),
      `State: ${describeState(server, false)}`,
    ];
    const error = [
      server.message,
      connection?.state === "connected" ? undefined : connection?.error,
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n");
    return {
      cancelLabel: "back",
      confirmLabel: "select",
      details: details.join("\n"),
      error: error || undefined,
      items,
      selected: items[0]?.value,
      title: `MCP server ${name}`,
    };
  };

  readonly showTools = (ui: uiTypes.McpUi, server: extensionInternalTypes.McpServer) =>
    Effect.runPromise(
      awaiting(function* () {
        const exposure = exposureOf(server.entry);
        const hasToolExposureOverrides =
          Object.keys(server.entry.config.toolExposure ?? {}).length > 0;
        yield* awaited(
          ui.menu(() => ({
            cancelLabel: "back",
            confirmLabel: "back",
            details: `Exposure ${exposure}: ${exposure === "hidden" ? "unreachable" : EXPOSURE_DESCRIPTIONS[exposure]}${hasToolExposureOverrides ? "\nSome tools override it with toolExposure." : ""}`,
            empty: "The server offers no tools.",
            items: (server.connection?.tools ?? []).map((tool) => {
              const toolExposure = getMcpToolExposure(server.entry.config, tool.name);
              const description = firstLine(tool.description ?? "");
              return {
                description:
                  toolExposure === exposure ? description : `[${toolExposure}] ${description}`,
                label: tool.name,
                value: tool.name,
              };
            }),
            title: `Tools of ${server.entry.name}`,
          })),
        );
      }),
    );

  readonly chooseExposure = (
    ui: uiTypes.McpUi,
    server: extensionInternalTypes.McpServer,
  ): Promise<string | undefined> =>
    Effect.runPromise(
      awaitingWith(function* () {
        const current = exposureOf(server.entry);
        const choice = yield* awaited(
          ui.menu(() => ({
            cancelLabel: "back",
            confirmLabel: "save",
            details:
              server.entry.scope === "extension"
                ? `Applies to this session; the server is registered by ${server.entry.source}.`
                : `Saved to ${server.entry.override ?? server.entry.source}.`,
            items: (
              Object.keys(EXPOSURE_DESCRIPTIONS) as (keyof typeof EXPOSURE_DESCRIPTIONS)[]
            ).map((exposure) => ({
              description: EXPOSURE_DESCRIPTIONS[exposure],
              label: `${exposure === current ? "✓ " : "  "}${exposure}`,
              value: exposure,
            })),
            selected: current,
            title: `Exposure of ${server.entry.name}`,
          })),
        );
        if (choice === undefined || choice === "" || choice === current) return undefined;
        return this.setExposure(server, choice as configTypes.McpExposure);
      }, this),
    );

  readonly signInWithUi = (
    ui: uiTypes.McpUi,
    server: extensionInternalTypes.McpServer,
  ): Promise<string | undefined> => {
    const title = `Sign in to ${server.entry.name}`;
    const cancel = new AbortController();
    const status = (message: string) => ui.status(title, message, () => cancel.abort());
    let authorizationUrl = "";
    status("Contacting the authorization server…");
    return this.signIn(
      server,
      {
        promptForRedirectUrl: (signal) =>
          Effect.runPromise(
            awaiting(function* () {
              const value = yield* awaited(ui.redirectUrl(title, authorizationUrl, signal));
              status("Connecting…");
              return value;
            }),
          ),
        showAuthorizationUrl: (url) => {
          authorizationUrl = url.href;
          this.openUrl(url.href);
        },
      },
      cancel.signal,
    );
  };

  readonly runInBackground = (
    ctx: extensionsTypesTypes.ExtensionContext,
    server: extensionInternalTypes.McpServer,
    operation: () => Promise<string | undefined>,
  ) => {
    const ready = operation();
    const attempt = server.attempt;
    const { signal } = this.session;
    const finish = (message: string | undefined) => {
      if (signal.aborted || server.attempt !== attempt || !this.servers.includes(server)) return;
      server.message = message;
      this.ensureDiscoveryActive(ctx);
      this.emitChange();
    };
    void this.track(ready.then(finish, (error: unknown) => finish(toErrorMessage(error))));
  };

  readonly runAction = (
    ui: uiTypes.McpUi,
    ctx: extensionsTypesTypes.ExtensionContext,
    server: extensionInternalTypes.McpServer,
    action: string,
  ) =>
    Effect.runPromise(
      awaitingWith(function* () {
        const { signal } = this.session;
        let message: string | undefined;
        switch (action) {
          case "signin":
            message = yield* awaited(this.signInWithUi(ui, server));
            break;
          case "reconnect":
            this.runInBackground(ctx, server, () =>
              Effect.runPromise(
                awaitingWith(function* () {
                  yield* awaited(this.reconnect(server));
                  return undefined;
                }, this),
              ),
            );
            break;
          case "signout":
            yield* awaited(this.signOut(server));
            break;
          case "tools":
            yield* awaited(this.showTools(ui, server));
            break;
          case "exposure":
            message = yield* awaited(this.chooseExposure(ui, server));
            break;
          case "enable":
          case "disable":
          case "enable-project":
          case "disable-project": {
            const enable = action.startsWith("enable");
            this.runInBackground(ctx, server, () =>
              this.setEnabled(server, enable, action.endsWith("-project")),
            );
            break;
          }
        }

        if (signal.aborted) return;
        server.message = message;
        this.ensureDiscoveryActive(ctx);
        this.emitChange();
      }, this),
    );

  readonly manage = (ui: uiTypes.McpUi, ctx: extensionsTypesTypes.ExtensionContext) =>
    Effect.runPromise(
      awaitingWith(function* () {
        for (;;) {
          const name = yield* awaited(ui.menu(this.serversMenu, this.subscribe));
          if (name === undefined || name === "") return;
          for (;;) {
            const action = yield* awaited(ui.menu(() => this.serverMenu(name), this.subscribe));
            const server = this.findServer(name);
            if (action === undefined || action === "" || server === undefined) break;
            yield* awaited(this.runAction(ui, ctx, server, action));
          }
        }
      }, this),
    );

  readonly formatStatus = (): string => {
    if (
      this.servers.length === 0 &&
      this.configErrors.length === 0 &&
      this.overridden.length === 0
    ) {
      return `No MCP servers configured. Add them to ${resolve(getAgentDir(), "mcp.json")} or .msa/mcp.json.`;
    }
    const lines = this.servers.map((server) => {
      const { name } = server.entry;
      const exposure = exposureOf(server.entry);
      const connection = server.connection;
      if (connection?.state === "needs-auth")
        return `${name}: needs sign-in, run /mcp login ${name} (${exposure})`;
      const tools = connection?.state === "connected" ? `, ${connection.tools.length} tools` : "";
      const state = isEnabled(server)
        ? connection?.state === "disconnected"
          ? "disconnected, reconnects on next call"
          : (connection?.state ?? "starting")
        : "disabled";
      const error =
        connection?.error !== undefined &&
        connection?.error !== "" &&
        connection.state !== "connected"
          ? `\n    ${connection.error.split("\n").join("\n    ")}`
          : "";
      return `${name}: ${state}${tools} (${exposure})${error}`;
    });
    for (const error of this.configErrors) lines.push(`config error: ${error}`);
    for (const line of this.overridden) lines.push(`overridden: ${line}`);
    return lines.join("\n");
  };

  readonly pickServer = (
    name: string | undefined,
    ctx: extensionsTypesTypes.ExtensionCommandContext,
    criteria: {
      eligible: (server: extensionInternalTypes.McpServer) => boolean;
      preferred: (server: extensionInternalTypes.McpServer) => boolean;
      none: string;
    },
  ): Promise<extensionInternalTypes.McpServer | undefined> =>
    Effect.runPromise(
      awaitingWith(function* () {
        if (name !== undefined && name !== "") {
          const server = this.findServer(name);
          if (server === undefined) ctx.ui.notify(`No MCP server named "${name}".`, "error");
          else if (!criteria.eligible(server)) ctx.ui.notify(criteria.none, "error");
          return server !== undefined && criteria.eligible(server) ? server : undefined;
        }
        const candidates = this.servers.filter(criteria.eligible);
        if (candidates.length === 0) {
          ctx.ui.notify(criteria.none, "info");
          return undefined;
        }
        const preferred = candidates.filter(criteria.preferred);
        if (candidates.length === 1) return candidates[0];
        if (preferred.length === 1) return preferred[0];
        const choice = yield* awaited(
          ctx.ui.select(
            "MCP server",
            candidates.map((server) => server.entry.name),
          ),
        );
        return candidates.find((server) => server.entry.name === choice);
      }, this),
    );

  readonly usesOAuth = (server: extensionInternalTypes.McpServer) =>
    server.connection?.auth.oauthUrl !== undefined;

  readonly oauthPick = {
    eligible: this.usesOAuth,
    none: "No enabled MCP server uses OAuth. Only HTTP servers without an Authorization header do.",
    preferred: (server: extensionInternalTypes.McpServer) =>
      server.connection?.state === "needs-auth",
  };

  readonly loginCommand = (
    server: extensionInternalTypes.McpServer,
    ctx: extensionsTypesTypes.ExtensionCommandContext,
  ) =>
    Effect.runPromise(
      awaitingWith(function* () {
        const { name } = server.entry;
        if (!ctx.hasUI) {
          ctx.ui.notify(`Signing in to MCP server "${name}" requires interactive mode.`, "error");
          return;
        }
        const { signal } = this.session;
        let failure: string | undefined;
        if (ctx.mode === "tui") {
          yield* awaited(
            showMcpManager(ctx, (ui) =>
              Effect.runPromise(
                awaitingWith(function* () {
                  failure = yield* awaited(this.signInWithUi(ui, server));
                }, this),
              ),
            ),
          );
        } else {
          failure = yield* awaited(
            this.signIn(server, {
              promptForRedirectUrl: (promptSignal) =>
                ctx.ui.input(
                  `Waiting for sign-in to "${name}". If the browser cannot reach this machine, paste the URL it was redirected to.`,
                  "http://127.0.0.1:.../callback?code=...",
                  { signal: promptSignal },
                ),
              showAuthorizationUrl: (url) => {
                ctx.ui.notify(
                  `Sign in to MCP server "${name}" in your browser:\n${url.href}`,
                  "info",
                );
                this.openUrl(url.href);
              },
            }),
          );
        }

        if (signal.aborted) return;
        if (failure !== undefined && failure !== "") {
          ctx.ui.notify(failure, failure === "Sign-in cancelled." ? "info" : "error");
          return;
        }
        this.ensureDiscoveryActive(ctx);
        ctx.ui.notify(
          `Signed in to MCP server "${name}" (${server.connection?.tools.length ?? 0} tools).`,
          "info",
        );
      }, this),
    );

  readonly waitForDirectServers = (ctx: extensionsTypesTypes.ExtensionContext) =>
    Effect.runPromise(
      awaitingWith(function* () {
        if (this.waitedForStartup) return;
        this.waitedForStartup = true;
        const ready = this.servers.flatMap((server) =>
          isEnabled(server) && hasDirectTools(server.entry) && server.ready !== undefined
            ? [server.ready]
            : [],
        );
        if (ready.length === 0) return;
        const finished = Option.isSome(
          yield* performed(
            Effect.promise(() => Promise.all(ready)).pipe(Effect.timeoutOption(this.startupWaitMs)),
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

  register(): void {
    this.msa.registerToolRenderer((toolName, next) => {
      const match = /^mcp__(.+?)__(.+)$/u.exec(toolName);
      return (
        next() ?? (match === null ? undefined : createMcpToolRenderers(`${match[1]}/${match[2]}`))
      );
    });

    this.msa.on("session_start", (_event, ctx) => {
      const loaded = (this.options.loadConfig ?? defaultLoadConfig)(ctx);
      this.configErrors = loaded.errors;
      this.projectConfig = loaded.projectConfig;
      this.autoEnableCodemode = loaded.autoEnableCodemode ?? true;
      this.warnedUnreachable = false;
      this.waitedForStartup = false;
      this.sessionCwd = ctx.cwd;
      this.modelRegistry = ctx.modelRegistry;
      this.session = new AbortController();
      const { signal } = this.session;
      this.configuredEntries = loaded.servers;
      const registered = this.registeredServers();
      this.overridden = registered.overridden;
      this.servers = [...loaded.servers.map((entry) => ({ entry })), ...registered.servers];
      this.emitChange();

      this.ensureDiscoveryActive(ctx);
      const enabled = this.servers.filter(isEnabled);
      if (enabled.length === 0) {
        this.reportProblems(ctx);
        return;
      }

      const runtime = Effect.runPromise(Effect.sleep(0)).then(() => loadMcpRuntime());
      this.pending = Promise.all(enabled.map((server) => this.startConnection(server, runtime)))
        .then(() => {
          if (!signal.aborted) this.reportProblems(ctx);
          return undefined;
        })
        .catch((error: unknown) => {
          try {
            ctx.ui.notify(`MCP failed to load: ${toErrorMessage(error)}`, "error");
          } catch {}
        });
    });

    this.msa.on("before_agent_start", (event, ctx) =>
      Effect.runPromise(
        awaitingWith(function* () {
          yield* awaited(this.waitForDirectServers(ctx));
          const { sections } = event.systemPromptOptions;
          const section = renderServersSection(this.servers);
          if (section !== undefined && section !== "") sections[MCP_SERVERS_SECTION] = section;
          else delete sections[MCP_SERVERS_SECTION];
        }, this),
      ),
    );

    this.msa.on("tool_call", (event, ctx) =>
      Effect.runPromise(
        awaitingWith(function* () {
          const tool = this.msa
            .getAllTools()
            .find((candidate) => candidate.name === event.toolName);
          if (tool === undefined) return;

          const readyServers = this.servers.filter((server) => isEnabled(server) && server.ready);
          if (readyServers.length === 0) return;
          const reach = tool.reachesTools?.(event.input);
          const owner = this.toolOwners.get(event.toolName)?.split("\0", 1)[0];
          const waiting =
            reach === undefined
              ? RESOURCE_TOOL_NAMES.has(tool.name)
                ? readyServers
                : readyServers.filter((server) => server.entry.name === owner)
              : readyServers.filter((server) => reachesServer(reach, server.entry.name));
          yield* awaited(this.waitForServers(waiting, ctx.signal));
        }, this),
      ),
    );

    this.msa.on("turn_start", (_event, ctx) =>
      Effect.runPromise(
        awaitingWith(function* () {
          if (this.tokensAtSignIn.size > 0) yield* awaited(this.reconnectSignedIn(ctx));
        }, this),
      ),
    );

    this.msa.on("mcp_servers_change", (_event, ctx) =>
      Effect.runPromise(
        awaitingWith(function* () {
          const { signal } = this.session;
          if (signal.aborted) return;
          const registered = this.registeredServers();
          this.overridden = registered.overridden;
          const next = new Map(registered.servers.map((server) => [server.entry.name, server]));

          const removed = this.servers.filter(
            (server) =>
              server.entry.scope === "extension" &&
              next.get(server.entry.name)?.registeredConfig !== server.registeredConfig,
          );
          this.servers = this.servers.filter((server) => !removed.includes(server));
          for (const server of removed) this.hideTools(server.entry.name);
          const added = registered.servers.filter(
            (server) => this.findServer(server.entry.name) === undefined,
          );
          this.servers.push(...added);
          this.emitChange();
          this.ensureDiscoveryActive(ctx);
          yield* awaited(Promise.all(removed.map((server) => server.connection?.close())));
          const connecting = added.filter(isEnabled);
          if (signal.aborted || connecting.length === 0) return;
          try {
            yield* awaited(Promise.all(connecting.map((server) => this.startConnection(server))));
            if (signal.aborted) {
              yield* awaited(Promise.all(connecting.map((server) => server.connection?.close())));
              return;
            }
          } catch (error) {
            ctx.ui.notify(`MCP failed to load: ${toErrorMessage(error)}`, "error");
            return;
          }
          if (signal.aborted) return;
          this.reportProblems(ctx, connecting);
        }, this),
      ),
    );

    this.msa.on("session_shutdown", () =>
      Effect.runPromise(
        awaitingWith(function* () {
          this.session.abort();
          const closing = this.connections();
          this.servers = [];
          this.emitChange();
          yield* awaited(
            Promise.all([
              ...this.backgroundActions,
              ...closing.map((connection) => connection.close()),
            ]),
          );
        }, this),
      ),
    );

    this.msa.registerCommand("mcp", {
      description: "Manage MCP servers: sign in, reconnect, enable or disable, and change exposure",
      getArgumentCompletions: (prefix) => {
        const [action, server, ...rest] = prefix.trimStart().split(/\s+/u);
        if (rest.length > 0) return null;
        if (server === undefined) {
          return ["login", "logout", "reconnect"]
            .filter((item) => item.startsWith(action ?? ""))
            .map((item) => ({ label: item, value: `${item} ` }));
        }
        if (action !== "login" && action !== "logout" && action !== "reconnect") return null;
        const items = this.servers
          .filter((candidate) =>
            action === "reconnect" ? candidate.connection !== undefined : this.usesOAuth(candidate),
          )
          .filter((candidate) => candidate.entry.name.startsWith(server))
          .map((candidate) => ({
            description: describeState(candidate),
            label: candidate.entry.name,
            value: `${action} ${candidate.entry.name}`,
          }));
        return items.length > 0 ? items : null;
      },
      handler: (args, ctx) =>
        Effect.runPromise(
          awaitingWith(function* () {
            const [action, name, ...extra] = args.trim().split(/\s+/u).filter(Boolean);
            if (action === undefined) {
              if (ctx.mode === "tui")
                yield* awaited(showMcpManager(ctx, (ui) => this.manage(ui, ctx)));
              else {
                yield* awaited(this.pending);
                ctx.ui.notify(this.formatStatus(), "info");
              }
              return;
            }
            if (extra.length > 0) {
              ctx.ui.notify(MCP_USAGE, "warning");
              return;
            }
            yield* awaited(this.pending);
            switch (action) {
              case "login": {
                const server = yield* awaited(this.pickServer(name, ctx, this.oauthPick));
                if (server !== undefined) yield* awaited(this.loginCommand(server, ctx));
                return;
              }
              case "logout": {
                const server = yield* awaited(this.pickServer(name, ctx, this.oauthPick));
                if (server === undefined) return;
                const removed = yield* awaited(this.signOut(server));
                ctx.ui.notify(
                  removed
                    ? `Signed out of MCP server "${server.entry.name}".`
                    : `No stored credentials for MCP server "${server.entry.name}".`,
                  "info",
                );
                return;
              }
              case "reconnect": {
                const server = yield* awaited(
                  this.pickServer(name, ctx, {
                    eligible: (candidate) => candidate.connection !== undefined,
                    none: "No enabled MCP server to reconnect.",
                    preferred: (candidate) =>
                      candidate.connection?.state === "failed" ||
                      candidate.connection?.state === "disconnected",
                  }),
                );
                if (server === undefined) return;
                return yield* handlerPart1(this.reconnect, server, ctx, this.ensureDiscoveryActive);
              }
              default:
                ctx.ui.notify(MCP_USAGE, "warning");
            }
          }, this),
        ),
    });
  }
}

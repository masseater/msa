import type tuiTypes from "@msa/tui/index.types";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { TSchema } from "typebox";

import { getAgentDir } from "../../config.ts";
import { awaited, awaiting, performed } from "../../core/awaiting.ts";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionFactory,
  ToolDefinition,
} from "../../core/extensions/types.ts";
import { mcpNamespace } from "../../core/mcp-servers.ts";
import type { ModelRegistry } from "../../core/model-registry.ts";
import { join, resolve } from "../../core/platform-node.ts";
import { toErrorMessage } from "../../utils/errors.ts";
import { callbackPromise } from "../../utils/interop.ts";
import { openBrowser } from "../../utils/open-browser.ts";
import { CODEMODE_TOOL_NAME } from "../codemode/tool.ts";
import { TOOL_SEARCH_TOOL_NAME } from "../tool-search/tool.ts";
import {
  type LoadedMcpConfig,
  type McpExposure,
  type McpServerConfigPatch,
  type McpServerEntry,
  getMcpToolExposure,
  loadMcpConfig,
  updateMcpServerConfig,
} from "./config.ts";
import type { McpOAuthCredentialStore, McpSignInPrompt } from "./oauth.ts";
import {
  LIST_MCP_RESOURCES_TOOL,
  LIST_MCP_RESOURCE_TEMPLATES_TOOL,
  READ_MCP_RESOURCE_TOOL,
  createMcpResourceToolDefinitions,
} from "./resources.ts";
import { loadMcpRuntime } from "./runtime.lazy.ts";
import type * as McpRuntime from "./runtime.ts";
import type { McpServerConnection, McpServerLog, McpTransportFactory } from "./runtime.ts";
import {
  type McpToolDetails,
  createMcpToolDefinition,
  createMcpToolName,
  createMcpToolRenderers,
} from "./tools.ts";
import { type McpMenu, type McpUi, showMcpManager } from "./ui.ts";

export type { McpTransportFactory } from "./runtime.ts";

export interface McpExtensionOptions {
  loadConfig?: (ctx: ExtensionContext) => LoadedMcpConfig;

  createTransport?: McpTransportFactory;

  credentials?: McpOAuthCredentialStore;

  logPath?: string;

  openUrl?: (url: string) => void;

  updateConfig?: (entry: McpServerEntry, patch: McpServerConfigPatch) => void;

  startupWaitMs?: number;
}

const DEFAULT_STARTUP_WAIT_MS = 10_000;

const RESOURCE_TOOL_NAMES: ReadonlySet<string> = new Set([
  LIST_MCP_RESOURCES_TOOL,
  LIST_MCP_RESOURCE_TEMPLATES_TOOL,
  READ_MCP_RESOURCE_TOOL,
]);

interface McpServer {
  entry: McpServerEntry;
  connection?: McpServerConnection | undefined;

  registeredConfig?: string;

  message?: string | undefined;

  attempt?: symbol | undefined;

  ready?: Promise<void>;

  closing?: Promise<void> | undefined;
}

const EXPOSURE_DESCRIPTIONS: Record<Exclude<McpExposure, "hidden">, string> = {
  codemode: "called from codemode scripts, which find them with searchTools()",
  deferred: "not declared until tool_search loads them, then called directly; no codemode needed",
  direct: "declared to the model like built-in tools",
};

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? "";
}

function isEnabled(server: Pick<McpServer, "entry">): boolean {
  return server.entry.config.enabled !== false;
}

function exposureOf(entry: McpServerEntry): McpExposure {
  return entry.config.exposure ?? "codemode";
}

function configuredExposures(entry: McpServerEntry): Set<McpExposure> {
  return new Set([exposureOf(entry), ...Object.values(entry.config.toolExposure ?? {})]);
}

function hasDirectTools(entry: McpServerEntry): boolean {
  return configuredExposures(entry).has("direct");
}

function hasIndirectTools(entry: McpServerEntry): boolean {
  const exposures = configuredExposures(entry);
  return exposures.has("codemode") || exposures.has("deferred");
}

export const MCP_SERVERS_SECTION = "mcp_servers";

const MAX_SERVER_DESCRIPTION_CHARS = 250;

export const MAX_SERVERS_SECTION_CHARS = 4096;

function serversSectionIntro(reaches: ReadonlySet<string>): string {
  let intro = "MCP servers whose tools are not declared to you.";
  if (reaches.has("codemode"))
    intro += " Call the tools of `codemode` servers from codemode scripts.";
  if (reaches.has("tool_search"))
    intro += " Load the tools of `tool_search` servers with `tool_search`.";
  return intro;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return max <= 1 ? "" : `${text.slice(0, max - 1).trimEnd()}…`;
}

export interface McpServerListing {
  entry: McpServerEntry;
  connection?: { instructions?: string | undefined } | undefined;
}

function serverSummary(server: McpServerListing): string {
  const text = server.entry.config.description?.trim() || server.connection?.instructions || "";
  return (text.split("\n", 1)[0] ?? "").trim();
}

export function renderServersSection(servers: readonly McpServerListing[]): string | undefined {
  const listed = servers
    .filter((server) => isEnabled(server) && hasIndirectTools(server.entry))
    .sort((a, b) => a.entry.name.localeCompare(b.entry.name));
  if (listed.length === 0) return undefined;
  const reaches = listed.map((server) =>
    configuredExposures(server.entry).has("codemode") ? "codemode" : "tool_search",
  );
  const intro = serversSectionIntro(new Set(reaches));
  const heads = listed.map(
    (server, index) => `- ${mcpNamespace(server.entry.name)} (${reaches[index]})`,
  );
  const omitted = (count: number) =>
    count > 0
      ? [`- … ${count} more server${count === 1 ? "" : "s"}; find their tools with searchTools()`]
      : [];

  const size = (kept: number) =>
    [intro, ...heads.slice(0, kept), ...omitted(listed.length - kept)].join("\n").length;
  let kept = listed.length;
  while (kept > 0 && size(kept) > MAX_SERVERS_SECTION_CHARS) kept--;

  const perServer =
    kept === 0
      ? 0
      : Math.min(
          MAX_SERVER_DESCRIPTION_CHARS,
          Math.floor((MAX_SERVERS_SECTION_CHARS - size(kept)) / kept) - 2,
        );
  const lines = listed.slice(0, kept).map((server, index) => {
    const summary = perServer > 0 ? truncate(serverSummary(server), perServer) : "";
    return summary === "" ? heads[index] : `${heads[index]}: ${summary}`;
  });
  return [intro, ...lines, ...omitted(listed.length - kept)].join("\n");
}

function reachesServer(reach: "all" | readonly string[], server: string): boolean {
  if (reach === "all") return true;
  const namespace = mcpNamespace(server);
  return reach.some((word) => word.includes(namespace));
}

function describeState(server: McpServer, withError = true): string {
  if (!isEnabled(server)) return "disabled";
  const connection = server.connection;
  if (connection === undefined) return "starting";
  switch (connection.state) {
    case "needs-auth":
      return "needs sign-in";
    case "failed":
      return withError ? `failed: ${firstLine(connection.error ?? "unknown error")}` : "failed";
    case "connected": {
      const { tools, hasResources } = connection;
      return `connected · ${tools.length} tool${tools.length === 1 ? "" : "s"}${hasResources ? " · resources" : ""}`;
    }
    case "connecting":
      return "connecting…";
    default:
      return connection.state;
  }
}

function attentionRank(server: McpServer): number {
  if (!isEnabled(server)) return 5;
  switch (server.connection?.state) {
    case "needs-auth":
      return 0;
    case "failed":
      return 1;
    case "disconnected":
      return 2;
    case "connected":
      return 4;
    default:
      return 3;
  }
}

function describeTransport(entry: McpServerEntry): string {
  const { config } = entry;
  if ("url" in config) return config.url;
  return [config.command, ...(config.args ?? [])].join(" ");
}

const MCP_USAGE = "Usage: /mcp, /mcp login [server], /mcp logout [server], /mcp reconnect [server]";

export function createMcpExtension(options: McpExtensionOptions = {}): ExtensionFactory {
  return (msa: ExtensionAPI) => {
    let servers: McpServer[] = [];

    let configuredEntries: McpServerEntry[] = [];
    let configErrors: string[] = [];

    let projectConfig: string | undefined;

    let overridden: string[] = [];
    let autoEnableCodemode = true;

    let warnedUnreachable = false;
    let pending: Promise<unknown> | undefined;

    let waitedForStartup = false;
    const startupWaitMs = options.startupWaitMs ?? DEFAULT_STARTUP_WAIT_MS;

    let sessionCwd = process.cwd();
    let credentials = options.credentials;

    let modelRegistry: ModelRegistry | undefined;
    let serverLog: McpServerLog | undefined;
    const openUrl = options.openUrl ?? openBrowser;
    const updateConfig =
      options.updateConfig ??
      ((entry, patch) =>
        updateMcpServerConfig(entry.override ?? entry.source, entry.name, patch, {
          override: entry.override !== undefined,
        }));

    let session = new AbortController();
    session.abort();

    const backgroundActions = new Set<Promise<void>>();
    const track = <T>(work: Promise<T>): Promise<T> => {
      const task = work.then(
        () => undefined,
        () => undefined,
      );
      backgroundActions.add(task);
      void task.finally(() => backgroundActions.delete(task));
      return work;
    };
    const listeners = new Set<() => void>();
    const emitChange = () => {
      for (const listener of listeners) listener();
    };
    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };

    const connections = () =>
      servers.flatMap((server) => (server.connection === undefined ? [] : [server.connection]));
    const findServer = (name: string) => servers.find((server) => server.entry.name === name);

    const registeredServers = (): { servers: McpServer[]; overridden: string[] } => {
      const registered: McpServer[] = [];
      const overriddenNames: string[] = [];
      for (const { name, config, extensionPath } of msa.getMcpServers()) {
        const configured = configuredEntries.find(
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

    const getCredentials = (runtime: typeof McpRuntime): McpOAuthCredentialStore => {
      credentials ??= new runtime.McpOAuthCredentialStore();
      return credentials;
    };

    const getServerLog = (runtime: typeof McpRuntime): McpServerLog => {
      serverLog ??= new runtime.McpServerLog(options.logPath ?? join(getAgentDir(), "mcp.log"));
      return serverLog;
    };

    const toolOwners = new Map<string, string>();

    const serverTools = new Map<string, Set<string>>();

    const definitions = new Map<string, ToolDefinition<TSchema, McpToolDetails>>();

    msa.registerToolRenderer((toolName, next) => {
      const match = /^mcp__(.+?)__(.+)$/u.exec(toolName);
      return (
        next() ?? (match === null ? undefined : createMcpToolRenderers(`${match[1]}/${match[2]}`))
      );
    });

    const registerTools = (connection: McpServerConnection) => {
      const server = connection.entry.name;
      const entry = findServer(server)?.entry ?? connection.entry;
      const description = entry.config.description?.trim();
      const namespace = {
        aliases: [server],

        name: mcpNamespace(server),
        ...(description !== undefined && description !== "" ? { description } : {}),
        ...(connection.instructions !== undefined && connection.instructions !== ""
          ? { instructions: connection.instructions }
          : {}),
      };
      const previous = serverTools.get(server) ?? new Set<string>();
      const current = new Set<string>();

      const plain = [...new Set(connection.tools.map((tool) => tool.name))].map((tool) =>
        createMcpToolName(server, tool),
      );
      const assignName = (tool: string, owner: string) => {
        const name = createMcpToolName(server, tool, (candidate) => {
          const existing = toolOwners.get(candidate);
          return (
            (existing !== undefined && existing !== owner) ||
            current.has(candidate) ||
            plain.indexOf(candidate) !== plain.lastIndexOf(candidate)
          );
        });
        toolOwners.set(name, owner);
        current.add(name);
        return name;
      };
      for (const tool of connection.tools) {
        const definition = createMcpToolDefinition({
          exposure: getMcpToolExposure(entry.config, tool.name),
          getClient: () =>
            Effect.runPromise(
              Effect.sync(() => {
                const resolved = findServer(server);
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
          readableResources: () => resourceServers().some((candidate) => candidate.name === server),
          server,
          timeoutMs: connection.timeoutMs,
          tool,
        });
        definitions.set(definition.name, definition);
        msa.registerTool(definition);
      }
      serverTools.set(server, current);

      for (const name of previous) {
        const definition = definitions.get(name);
        if (!current.has(name) && definition !== undefined)
          msa.registerTool({ ...definition, exposure: "hidden" });
      }
      syncResourceTools();
    };

    const hideTools = (server: string) => {
      for (const name of serverTools.get(server) ?? []) {
        const definition = definitions.get(name);
        if (definition !== undefined) msa.registerTool({ ...definition, exposure: "hidden" });
      }
      serverTools.set(server, new Set());
      syncResourceTools();
    };

    const serversWithResources = (): McpServer[] =>
      servers.filter(
        (server) =>
          server.connection?.hasResources &&
          isEnabled(server) &&
          exposureOf(server.entry) !== "hidden",
      );
    const resourceServers = (): McpServerConnection[] =>
      serversWithResources().flatMap((server) =>
        server.connection === undefined ? [] : [server.connection],
      );

    let resourceToolsExposure: McpExposure | undefined;

    const syncResourceTools = () => {
      const exposures = new Set(serversWithResources().map((server) => exposureOf(server.entry)));
      const exposure = (["direct", "codemode", "deferred"] as const).find((candidate) =>
        exposures.has(candidate),
      );
      const next = exposure ?? "hidden";
      if (
        next === resourceToolsExposure ||
        (resourceToolsExposure === undefined && next === "hidden")
      )
        return;
      const wasDirect = resourceToolsExposure === "direct";
      resourceToolsExposure = next;
      const resourceDefinitions = createMcpResourceToolDefinitions({
        exposure: next,
        servers: resourceServers,
      });
      for (const definition of resourceDefinitions) msa.registerTool(definition);
      if (wasDirect) {
        const names = new Set(resourceDefinitions.map((definition) => definition.name));
        msa.setActiveTools(msa.getActiveTools().filter((name) => !names.has(name)));
      }
    };

    const ensureDiscoveryActive = (ctx: ExtensionContext) => {
      const exposures = new Set<McpExposure>();
      for (const server of servers) {
        if (isEnabled(server))
          for (const exposure of configuredExposures(server.entry)) exposures.add(exposure);
      }
      const needsCodemode = exposures.has("codemode");
      const needsToolSearch = exposures.has("deferred");
      if (!needsCodemode && !needsToolSearch) return;

      const tools = msa.getAllTools();
      const hasReachingTool = (name: string) =>
        tools.some((tool) => tool.name === name && tool.reachesTools);
      const hasCodemode = hasReachingTool(CODEMODE_TOOL_NAME);
      const hasToolSearch = hasReachingTool(TOOL_SEARCH_TOOL_NAME);
      const active = msa.getActiveTools();
      const activate: string[] = [];
      if (
        needsCodemode &&
        hasCodemode &&
        autoEnableCodemode &&
        !active.includes(CODEMODE_TOOL_NAME)
      ) {
        activate.push(CODEMODE_TOOL_NAME);
      }
      if (needsToolSearch && hasToolSearch && !active.includes(TOOL_SEARCH_TOOL_NAME)) {
        activate.push(TOOL_SEARCH_TOOL_NAME);
      }
      if (activate.length > 0) msa.setActiveTools([...active, ...activate]);
      const reachable = [...active, ...activate];
      if (hasCodemode && reachable.includes(CODEMODE_TOOL_NAME)) return;
      if (hasToolSearch && reachable.includes(TOOL_SEARCH_TOOL_NAME)) return;
      if (warnedUnreachable) return;
      warnedUnreachable = true;
      const reason =
        needsCodemode && hasCodemode && !autoEnableCodemode ? " (autoEnableCodemode is false)" : "";
      ctx.ui.notify(
        `MCP tools are only reachable from the codemode or tool_search tool, but neither is active${reason}; they cannot be called.`,
        "warning",
      );
    };

    const tokensAtSignIn = new Map<McpServerConnection, string>();
    const storedTokens = (connection: McpServerConnection): string => {
      const url = connection.oauthUrl;
      return url !== undefined && url !== "" && credentials !== undefined
        ? JSON.stringify(credentials.tokens(connection.name, url) ?? null)
        : "null";
    };
    const onConnectionChange = (connection: McpServerConnection) => {
      if (connection.state !== "needs-auth") tokensAtSignIn.delete(connection);
      else if (!tokensAtSignIn.has(connection))
        tokensAtSignIn.set(connection, storedTokens(connection));
      emitChange();
    };

    const reconnectSignedIn = (ctx: ExtensionContext) =>
      Effect.runPromise(
        awaiting(function* () {
          const signedIn = [...tokensAtSignIn].filter(
            ([connection, tokens]) => storedTokens(connection) !== tokens,
          );
          if (signedIn.length === 0) return;
          for (const [connection] of signedIn) tokensAtSignIn.delete(connection);
          yield* awaited(
            Promise.allSettled(signedIn.map(([connection]) => connection.reconnect())),
          );
          ensureDiscoveryActive(ctx);
        }),
      );

    const createConnection = (
      server: McpServer,
      isCurrent: () => boolean,
    ): Promise<McpServerConnection | undefined> =>
      Effect.runPromise(
        awaiting(function* () {
          const runtime = yield* awaited(loadMcpRuntime());
          if (!isCurrent()) return undefined;
          const connection = new runtime.McpServerConnection({
            createTransport: options.createTransport ?? runtime.createDefaultTransport,
            credentials: getCredentials(runtime),
            cwd: sessionCwd,
            entry: server.entry,
            log: getServerLog(runtime),
            onChange: (serverConnection) => {
              if (isCurrent()) onConnectionChange(serverConnection);
              else tokensAtSignIn.delete(serverConnection);
            },
            onTools: (serverConnection) => {
              if (isCurrent()) registerTools(serverConnection);
            },
            providerToken: (provider) =>
              Effect.runPromise(
                awaiting(function* () {
                  return yield* awaited(modelRegistry?.getApiKeyForProvider(provider));
                }),
              ),
          });
          server.connection = connection;
          emitChange();
          return connection;
        }),
      );

    const startConnection = (server: McpServer, after?: Promise<unknown>): Promise<void> => {
      const { signal } = session;
      const attempt = Symbol("connection attempt");
      server.attempt = attempt;
      const isCurrent = () =>
        !signal.aborted &&
        server.attempt === attempt &&
        isEnabled(server) &&
        servers.includes(server);
      const ready = (() =>
        Effect.runPromise(
          awaiting(function* () {
            yield* awaited(after);
            if (!isCurrent()) return;
            const connection = yield* awaited(createConnection(server, isCurrent));
            if (connection === undefined || !isCurrent()) return;
            yield* awaited(connection.getClient().catch(() => undefined));
          }),
        ))();
      server.ready = ready.catch(() => undefined);
      return ready;
    };

    const waitForServers = (waiting: readonly McpServer[], signal: AbortSignal | undefined) =>
      Effect.runPromise(
        awaiting(function* () {
          const readyOf = () =>
            waiting.flatMap((server) =>
              isEnabled(server) && servers.includes(server) && server.ready !== undefined
                ? [{ ready: server.ready, server }]
                : [],
            );
          const unchanged = (ready: ReturnType<typeof readyOf>) =>
            ready.every(
              (attempt) =>
                !isEnabled(attempt.server) ||
                !servers.includes(attempt.server) ||
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
        }),
      );

    const reportProblems = (ctx: ExtensionContext, only?: readonly McpServer[]) => {
      const lines = only === undefined ? configErrors.map((error) => `config: ${error}`) : [];
      for (const server of only ?? servers) {
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

    const saveConfig = (
      server: McpServer,
      patch: McpServerConfigPatch,
      inProject = false,
    ): string | undefined => {
      const override = inProject ? projectConfig : server.entry.override;
      const entry =
        override !== undefined && override !== "" ? { ...server.entry, override } : server.entry;
      if (entry.scope !== "extension") {
        try {
          updateConfig(entry, patch);
        } catch (error) {
          return `Could not update ${entry.override ?? entry.source}: ${toErrorMessage(error)}`;
        }
      }
      server.entry = { ...entry, config: { ...entry.config, ...patch } };
      return undefined;
    };

    const signIn = (
      server: McpServer,
      prompt: McpSignInPrompt,
      cancel?: AbortSignal,
    ): Promise<string | undefined> =>
      Effect.runPromise(
        awaiting(function* () {
          const connection = server.connection;
          const url = connection?.oauthUrl;
          if (connection === undefined || url === undefined || url === "")
            return `MCP server "${server.entry.name}" does not use OAuth.`;
          const runtime = yield* awaited(loadMcpRuntime());
          const signal =
            cancel === undefined ? session.signal : AbortSignal.any([session.signal, cancel]);
          try {
            yield* awaited(
              track(
                runtime.signInMcpServer({
                  challenge: connection.challenge,
                  prompt,
                  serverUrl: url,
                  settings: connection.oauthSettings(),
                  signal,
                  store: getCredentials(runtime).forServer(server.entry.name, url),
                }),
              ),
            );
          } catch (error) {
            if (error instanceof runtime.McpSignInCancelledError) return "Sign-in cancelled.";
            return `Sign-in failed: ${toErrorMessage(error)}`;
          }

          connection.challenge = undefined;
          try {
            yield* awaited(connection.reconnect());
          } catch (error) {
            return `Signed in, but ${toErrorMessage(error)}`;
          }
          return undefined;
        }),
      );

    const signOut = (server: McpServer): Promise<boolean> =>
      Effect.runPromise(
        awaiting(function* () {
          const connection = server.connection;
          const url = connection?.oauthUrl;
          if (connection === undefined || url === undefined || url === "") return false;
          const removed = getCredentials(yield* awaited(loadMcpRuntime())).remove(
            server.entry.name,
            url,
          );
          yield* awaited(connection.signOut());
          return removed;
        }),
      );

    const reconnect = (server: McpServer): Promise<string | undefined> =>
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

    const setEnabled = (
      server: McpServer,
      enabled: boolean,
      inProject = false,
    ): Promise<string | undefined> =>
      Effect.runPromise(
        awaiting(function* () {
          const failed = saveConfig(server, { enabled }, inProject);
          if (failed !== undefined && failed !== "") return failed;
          if (!enabled) {
            const connection = server.connection;
            server.attempt = undefined;
            server.connection = undefined;
            if (connection !== undefined) {
              server.closing = Promise.all([connection.close(), server.ready]).then(
                () => undefined,
              );
            }
            const closing = server.closing;
            hideTools(server.entry.name);
            emitChange();
            try {
              yield* awaited(closing);
            } finally {
              if (server.closing === closing) server.closing = undefined;
            }
            return undefined;
          }
          yield* awaited(startConnection(server, server.closing));
          return undefined;
        }),
      );

    const setExposure = (server: McpServer, exposure: McpExposure): string | undefined => {
      const failed = saveConfig(server, { exposure });
      if (failed !== undefined && failed !== "") return failed;
      if (server.connection?.state === "connected") registerTools(server.connection);
      syncResourceTools();

      const indirect = new Set(
        msa
          .getAllTools()
          .filter((tool) => tool.exposure !== "direct")
          .map((tool) => tool.name),
      );
      const tools = serverTools.get(server.entry.name) ?? new Set<string>();
      msa.setActiveTools(
        msa.getActiveTools().filter((name) => !tools.has(name) || !indirect.has(name)),
      );
      emitChange();
      return undefined;
    };

    const notices = () => [
      ...configErrors.map((error) => `config: ${error}`),
      ...overridden.map((line) => `overridden: ${line}`),
    ];

    const serversMenu = (): McpMenu => ({
      cancelLabel: "close",
      confirmLabel: "manage",
      empty: `No MCP servers configured. Add them to ${resolve(getAgentDir(), "mcp.json")} or .msa/mcp.json.`,
      error: notices().join("\n") || undefined,
      items: [...servers]
        .sort(
          (a, b) => attentionRank(a) - attentionRank(b) || a.entry.name.localeCompare(b.entry.name),
        )
        .map((server) => ({
          value: server.entry.name,
          label: server.entry.name,
          description: `${describeState(server)} · ${exposureOf(server.entry)} · ${server.entry.override !== undefined && server.entry.override !== "" ? "global, project override" : (server.entry.scope ?? server.entry.source)}`,
        })),
      title: "MCP servers",
    });

    const serverMenu = (name: string): McpMenu => {
      const server = findServer(name);
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
        projectConfig !== undefined;
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
          connection?.oauthUrl !== undefined &&
          connection?.oauthUrl !== ""
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

    const showTools = (ui: McpUi, server: McpServer) =>
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
                  value: tool.name,
                  label: tool.name,
                  description:
                    toolExposure === exposure ? description : `[${toolExposure}] ${description}`,
                };
              }),
              title: `Tools of ${server.entry.name}`,
            })),
          );
        }),
      );

    const chooseExposure = (ui: McpUi, server: McpServer): Promise<string | undefined> =>
      Effect.runPromise(
        awaiting(function* () {
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
                value: exposure,
                label: `${exposure === current ? "✓ " : "  "}${exposure}`,
                description: EXPOSURE_DESCRIPTIONS[exposure],
              })),
              selected: current,
              title: `Exposure of ${server.entry.name}`,
            })),
          );
          if (choice === undefined || choice === "" || choice === current) return undefined;
          return setExposure(server, choice as McpExposure);
        }),
      );

    const signInWithUi = (ui: McpUi, server: McpServer): Promise<string | undefined> => {
      const title = `Sign in to ${server.entry.name}`;
      const cancel = new AbortController();
      const status = (message: string) => ui.status(title, message, () => cancel.abort());
      let authorizationUrl = "";
      status("Contacting the authorization server…");
      return signIn(
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
            openUrl(url.href);
          },
        },
        cancel.signal,
      );
    };

    const runInBackground = (
      ctx: ExtensionContext,
      server: McpServer,
      operation: () => Promise<string | undefined>,
    ) => {
      const ready = operation();
      const attempt = server.attempt;
      const { signal } = session;
      const finish = (message: string | undefined) => {
        if (signal.aborted || server.attempt !== attempt || !servers.includes(server)) return;
        server.message = message;
        ensureDiscoveryActive(ctx);
        emitChange();
      };
      void track(ready.then(finish, (error: unknown) => finish(toErrorMessage(error))));
    };

    const runAction = (ui: McpUi, ctx: ExtensionContext, server: McpServer, action: string) =>
      Effect.runPromise(
        awaiting(function* () {
          const { signal } = session;
          let message: string | undefined;
          switch (action) {
            case "signin":
              message = yield* awaited(signInWithUi(ui, server));
              break;
            case "reconnect":
              runInBackground(ctx, server, () =>
                Effect.runPromise(
                  awaiting(function* () {
                    yield* awaited(reconnect(server));
                    return undefined;
                  }),
                ),
              );
              break;
            case "signout":
              yield* awaited(signOut(server));
              break;
            case "tools":
              yield* awaited(showTools(ui, server));
              break;
            case "exposure":
              message = yield* awaited(chooseExposure(ui, server));
              break;
            case "enable":
            case "disable":
            case "enable-project":
            case "disable-project": {
              const enable = action.startsWith("enable");
              runInBackground(ctx, server, () =>
                setEnabled(server, enable, action.endsWith("-project")),
              );
              break;
            }
          }

          if (signal.aborted) return;
          server.message = message;
          ensureDiscoveryActive(ctx);
          emitChange();
        }),
      );
    const manage = (ui: McpUi, ctx: ExtensionContext) =>
      Effect.runPromise(
        awaiting(function* () {
          for (;;) {
            const name = yield* awaited(ui.menu(serversMenu, subscribe));
            if (name === undefined || name === "") return;
            for (;;) {
              const action = yield* awaited(ui.menu(() => serverMenu(name), subscribe));
              const server = findServer(name);
              if (action === undefined || action === "" || server === undefined) break;
              yield* awaited(runAction(ui, ctx, server, action));
            }
          }
        }),
      );

    const formatStatus = (): string => {
      if (servers.length === 0 && configErrors.length === 0 && overridden.length === 0) {
        return `No MCP servers configured. Add them to ${resolve(getAgentDir(), "mcp.json")} or .msa/mcp.json.`;
      }
      const lines = servers.map((server) => {
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
      for (const error of configErrors) lines.push(`config error: ${error}`);
      for (const line of overridden) lines.push(`overridden: ${line}`);
      return lines.join("\n");
    };

    const pickServer = (
      name: string | undefined,
      ctx: ExtensionCommandContext,
      criteria: {
        eligible: (server: McpServer) => boolean;
        preferred: (server: McpServer) => boolean;
        none: string;
      },
    ): Promise<McpServer | undefined> =>
      Effect.runPromise(
        awaiting(function* () {
          if (name !== undefined && name !== "") {
            const server = findServer(name);
            if (server === undefined) ctx.ui.notify(`No MCP server named "${name}".`, "error");
            else if (!criteria.eligible(server)) ctx.ui.notify(criteria.none, "error");
            return server !== undefined && criteria.eligible(server) ? server : undefined;
          }
          const candidates = servers.filter(criteria.eligible);
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
        }),
      );

    const usesOAuth = (server: McpServer) => server.connection?.oauthUrl !== undefined;
    const oauthPick = {
      eligible: usesOAuth,
      none: "No enabled MCP server uses OAuth. Only HTTP servers without an Authorization header do.",
      preferred: (server: McpServer) => server.connection?.state === "needs-auth",
    };

    const loginCommand = (server: McpServer, ctx: ExtensionCommandContext) =>
      Effect.runPromise(
        awaiting(function* () {
          const { name } = server.entry;
          if (!ctx.hasUI) {
            ctx.ui.notify(`Signing in to MCP server "${name}" requires interactive mode.`, "error");
            return;
          }
          const { signal } = session;
          let failure: string | undefined;
          if (ctx.mode === "tui") {
            yield* awaited(
              showMcpManager(ctx, (ui) =>
                Effect.runPromise(
                  awaiting(function* () {
                    failure = yield* awaited(signInWithUi(ui, server));
                  }),
                ),
              ),
            );
          } else {
            failure = yield* awaited(
              signIn(server, {
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
                  openUrl(url.href);
                },
              }),
            );
          }

          if (signal.aborted) return;
          if (failure !== undefined && failure !== "") {
            ctx.ui.notify(failure, failure === "Sign-in cancelled." ? "info" : "error");
            return;
          }
          ensureDiscoveryActive(ctx);
          ctx.ui.notify(
            `Signed in to MCP server "${name}" (${server.connection?.tools.length ?? 0} tools).`,
            "info",
          );
        }),
      );

    msa.on("session_start", (_event, ctx) => {
      const loaded = (options.loadConfig ?? defaultLoadConfig)(ctx);
      configErrors = loaded.errors;
      projectConfig = loaded.projectConfig;
      autoEnableCodemode = loaded.autoEnableCodemode ?? true;
      warnedUnreachable = false;
      waitedForStartup = false;
      sessionCwd = ctx.cwd;
      modelRegistry = ctx.modelRegistry;
      session = new AbortController();
      const { signal } = session;
      configuredEntries = loaded.servers;
      const registered = registeredServers();
      overridden = registered.overridden;
      servers = [...loaded.servers.map((entry) => ({ entry })), ...registered.servers];
      emitChange();

      ensureDiscoveryActive(ctx);
      const enabled = servers.filter(isEnabled);
      if (enabled.length === 0) {
        reportProblems(ctx);
        return;
      }

      const runtime = Effect.runPromise(Effect.sleep(0)).then(() => loadMcpRuntime());
      pending = Promise.all(enabled.map((server) => startConnection(server, runtime)))
        .then(() => {
          if (!signal.aborted) reportProblems(ctx);
          return undefined;
        })
        .catch((error: unknown) => {
          try {
            ctx.ui.notify(`MCP failed to load: ${toErrorMessage(error)}`, "error");
          } catch {}
        });
    });

    const waitForDirectServers = (ctx: ExtensionContext) =>
      Effect.runPromise(
        awaiting(function* () {
          if (waitedForStartup) return;
          waitedForStartup = true;
          const ready = servers.flatMap((server) =>
            isEnabled(server) && hasDirectTools(server.entry) && server.ready !== undefined
              ? [server.ready]
              : [],
          );
          if (ready.length === 0) return;
          const finished = Option.isSome(
            yield* performed(
              Effect.promise(() => Promise.all(ready)).pipe(Effect.timeoutOption(startupWaitMs)),
            ),
          );
          if (!finished) {
            ctx.ui.notify(
              "MCP servers are still connecting; their tools become available once connected.",
              "info",
            );
          }
        }),
      );

    msa.on("before_agent_start", (event, ctx) =>
      Effect.runPromise(
        awaiting(function* () {
          yield* awaited(waitForDirectServers(ctx));
          const { sections } = event.systemPromptOptions;
          const section = renderServersSection(servers);
          if (section !== undefined && section !== "") sections[MCP_SERVERS_SECTION] = section;
          else delete sections[MCP_SERVERS_SECTION];
        }),
      ),
    );

    msa.on("tool_call", (event, ctx) =>
      Effect.runPromise(
        awaiting(function* () {
          const tool = msa.getAllTools().find((candidate) => candidate.name === event.toolName);
          if (tool === undefined) return;

          const readyServers = servers.filter((server) => isEnabled(server) && server.ready);
          if (readyServers.length === 0) return;
          const reach = tool.reachesTools?.(event.input);
          const owner = toolOwners.get(event.toolName)?.split("\0", 1)[0];
          const waiting =
            reach === undefined
              ? RESOURCE_TOOL_NAMES.has(tool.name)
                ? readyServers
                : readyServers.filter((server) => server.entry.name === owner)
              : readyServers.filter((server) => reachesServer(reach, server.entry.name));
          yield* awaited(waitForServers(waiting, ctx.signal));
        }),
      ),
    );

    msa.on("turn_start", (_event, ctx) =>
      Effect.runPromise(
        awaiting(function* () {
          if (tokensAtSignIn.size > 0) yield* awaited(reconnectSignedIn(ctx));
        }),
      ),
    );

    msa.on("mcp_servers_change", (_event, ctx) =>
      Effect.runPromise(
        awaiting(function* () {
          const { signal } = session;
          if (signal.aborted) return;
          const registered = registeredServers();
          overridden = registered.overridden;
          const next = new Map(registered.servers.map((server) => [server.entry.name, server]));

          const removed = servers.filter(
            (server) =>
              server.entry.scope === "extension" &&
              next.get(server.entry.name)?.registeredConfig !== server.registeredConfig,
          );
          servers = servers.filter((server) => !removed.includes(server));
          for (const server of removed) hideTools(server.entry.name);
          const added = registered.servers.filter(
            (server) => findServer(server.entry.name) === undefined,
          );
          servers.push(...added);
          emitChange();
          ensureDiscoveryActive(ctx);
          yield* awaited(Promise.all(removed.map((server) => server.connection?.close())));
          const connecting = added.filter(isEnabled);
          if (signal.aborted || connecting.length === 0) return;
          try {
            yield* awaited(Promise.all(connecting.map((server) => startConnection(server))));
            if (signal.aborted) {
              yield* awaited(Promise.all(connecting.map((server) => server.connection?.close())));
              return;
            }
          } catch (error) {
            ctx.ui.notify(`MCP failed to load: ${toErrorMessage(error)}`, "error");
            return;
          }
          if (signal.aborted) return;
          reportProblems(ctx, connecting);
        }),
      ),
    );

    msa.on("session_shutdown", () =>
      Effect.runPromise(
        awaiting(function* () {
          session.abort();
          const closing = connections();
          servers = [];
          emitChange();
          yield* awaited(
            Promise.all([...backgroundActions, ...closing.map((connection) => connection.close())]),
          );
        }),
      ),
    );

    msa.registerCommand("mcp", {
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
        const items = servers
          .filter((candidate) =>
            action === "reconnect" ? candidate.connection !== undefined : usesOAuth(candidate),
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
          awaiting(function* () {
            const [action, name, ...extra] = args.trim().split(/\s+/u).filter(Boolean);
            if (action === undefined) {
              if (ctx.mode === "tui") yield* awaited(showMcpManager(ctx, (ui) => manage(ui, ctx)));
              else {
                yield* awaited(pending);
                ctx.ui.notify(formatStatus(), "info");
              }
              return;
            }
            if (extra.length > 0) {
              ctx.ui.notify(MCP_USAGE, "warning");
              return;
            }
            yield* awaited(pending);
            switch (action) {
              case "login": {
                const server = yield* awaited(pickServer(name, ctx, oauthPick));
                if (server !== undefined) yield* awaited(loginCommand(server, ctx));
                return;
              }
              case "logout": {
                const server = yield* awaited(pickServer(name, ctx, oauthPick));
                if (server === undefined) return;
                const removed = yield* awaited(signOut(server));
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
                  pickServer(name, ctx, {
                    eligible: (candidate) => candidate.connection !== undefined,
                    none: "No enabled MCP server to reconnect.",
                    preferred: (candidate) =>
                      candidate.connection?.state === "failed" ||
                      candidate.connection?.state === "disconnected",
                  }),
                );
                if (server === undefined) return;
                const failure = yield* awaited(reconnect(server));
                if (failure !== undefined && failure !== "") ctx.ui.notify(failure, "error");
                else {
                  ensureDiscoveryActive(ctx);
                  ctx.ui.notify(
                    `Reconnected to MCP server "${server.entry.name}" (${describeState(server)}).`,
                    "info",
                  );
                }
                return;
              }
              default:
                ctx.ui.notify(MCP_USAGE, "warning");
            }
          }),
        ),
    });
  };
}

function defaultLoadConfig(ctx: ExtensionContext): LoadedMcpConfig {
  return loadMcpConfig({
    agentDir: getAgentDir(),
    cwd: ctx.cwd,
    projectTrusted: ctx.isProjectTrusted(),
  });
}

export default createMcpExtension();

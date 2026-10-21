import * as Effect from "effect/Effect";
import type { TSchema } from "typebox";

import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import mcpServers from "../../../core/mcp-servers.ts";
import toolModule from "../../codemode/tool.ts";
import toolSearchTool from "../../tool-search/tool.ts";
import configModule from "../config.ts";
import type configTypes from "../config.types.ts";
import type extensionInternalTypes from "../extension-internal.types.ts";
import extensionPart1 from "../extension-part1.ts";
import resources from "../resources.ts";
import type runtimeTypes from "../runtime.types.ts";
import toolsModule from "../tools.ts";
import type toolsTypes from "../tools.types.ts";
import type McpExtensionHost from "./host.ts";

const { configuredExposures, exposureOf, isEnabled } = extensionPart1;
const { getMcpToolExposure } = configModule;
const { mcpNamespace } = mcpServers;
const { createMcpToolDefinition, createMcpToolName } = toolsModule;
const { createMcpResourceToolDefinitions } = resources;
const { CODEMODE_TOOL_NAME } = toolModule;
const { TOOL_SEARCH_TOOL_NAME } = toolSearchTool;

export default class McpToolRegistry {
  private readonly host: McpExtensionHost;

  constructor(host: McpExtensionHost) {
    this.host = host;
  }

  readonly toolOwners = new Map<string, string>();

  readonly serverTools = new Map<string, Set<string>>();

  readonly definitions = new Map<
    string,
    extensionsTypesTypes.ToolDefinition<TSchema, toolsTypes.McpToolDetails>
  >();

  readonly registerTools = (connection: runtimeTypes.McpServerConnection) => {
    const server = connection.entry.name;
    const entry = this.host.findServer(server)?.entry ?? connection.entry;
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
              const resolved = this.host.findServer(server);
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
      this.host.msa.registerTool(definition);
    }
    this.serverTools.set(server, current);

    for (const name of previous) {
      const definition = this.definitions.get(name);
      if (!current.has(name) && definition !== undefined)
        this.host.msa.registerTool({ ...definition, exposure: "hidden" });
    }
    this.syncResourceTools();
  };

  readonly hideTools = (server: string) => {
    for (const name of this.serverTools.get(server) ?? []) {
      const definition = this.definitions.get(name);
      if (definition !== undefined)
        this.host.msa.registerTool({ ...definition, exposure: "hidden" });
    }
    this.serverTools.set(server, new Set());
    this.syncResourceTools();
  };

  readonly serversWithResources = (): extensionInternalTypes.McpServer[] =>
    this.host.servers.filter(
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
    for (const definition of resourceDefinitions) this.host.msa.registerTool(definition);
    if (wasDirect) {
      const names = new Set(resourceDefinitions.map((definition) => definition.name));
      this.host.msa.setActiveTools(
        this.host.msa.getActiveTools().filter((name) => !names.has(name)),
      );
    }
  };

  readonly ensureDiscoveryActive = (ctx: extensionsTypesTypes.ExtensionContext) => {
    const exposures = new Set<configTypes.McpExposure>();
    for (const server of this.host.servers) {
      if (isEnabled(server))
        for (const exposure of configuredExposures(server.entry)) exposures.add(exposure);
    }
    const needsCodemode = exposures.has("codemode");
    const needsToolSearch = exposures.has("deferred");
    if (!needsCodemode && !needsToolSearch) return;

    const tools = this.host.msa.getAllTools();
    const hasReachingTool = (name: string) =>
      tools.some((tool) => tool.name === name && tool.reachesTools);
    const hasCodemode = hasReachingTool(CODEMODE_TOOL_NAME);
    const hasToolSearch = hasReachingTool(TOOL_SEARCH_TOOL_NAME);
    const active = this.host.msa.getActiveTools();
    const activate: string[] = [];
    if (
      needsCodemode &&
      hasCodemode &&
      this.host.autoEnableCodemode &&
      !active.includes(CODEMODE_TOOL_NAME)
    ) {
      activate.push(CODEMODE_TOOL_NAME);
    }
    if (needsToolSearch && hasToolSearch && !active.includes(TOOL_SEARCH_TOOL_NAME)) {
      activate.push(TOOL_SEARCH_TOOL_NAME);
    }
    if (activate.length > 0) this.host.msa.setActiveTools([...active, ...activate]);
    const reachable = [...active, ...activate];
    if (hasCodemode && reachable.includes(CODEMODE_TOOL_NAME)) return;
    if (hasToolSearch && reachable.includes(TOOL_SEARCH_TOOL_NAME)) return;
    if (this.host.warnedUnreachable) return;
    this.host.warnedUnreachable = true;
    const reason =
      needsCodemode && hasCodemode && !this.host.autoEnableCodemode
        ? " (autoEnableCodemode is false)"
        : "";
    ctx.ui.notify(
      `MCP tools are only reachable from the codemode or tool_search tool, but neither is active${reason}; they cannot be called.`,
      "warning",
    );
  };
}

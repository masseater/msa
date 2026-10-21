import * as Effect from "effect/Effect";

import mcpServers from "../../../core/mcp-servers.ts";
import configModule from "../config.ts";
import type runtimeTypes from "../runtime.types.ts";
import toolsModule from "../tools.ts";
import type toolsTypes from "../tools.types.ts";
import type McpExtensionHost from "./host.ts";
import McpResourceTools from "./resource-tools.ts";
import serverState from "./server-state.ts";
import McpToolDiscovery from "./tool-discovery.ts";

const { isEnabled } = serverState;
const { getMcpToolExposure } = configModule;
const { mcpNamespace } = mcpServers;
const { createMcpToolDefinition, createMcpToolName } = toolsModule;

export default class McpToolRegistry {
  private readonly host: McpExtensionHost;

  readonly discovery: McpToolDiscovery;

  readonly resourceTools: McpResourceTools;

  constructor(host: McpExtensionHost) {
    this.host = host;
    this.discovery = new McpToolDiscovery(host);
    this.resourceTools = new McpResourceTools(host);
  }

  readonly toolOwners = new Map<string, string>();

  readonly serverTools = new Map<string, Set<string>>();

  readonly definitions = new Map<string, toolsTypes.McpToolDefinition>();

  private toolNamespace(
    connection: runtimeTypes.McpServerConnection,
    entry: runtimeTypes.McpServerConnection["entry"],
  ) {
    const server = connection.entry.name;
    const description = entry.config.description?.trim();
    return {
      aliases: [server],
      name: mcpNamespace(server),
      ...(description !== undefined && description !== "" ? { description } : {}),
      ...(connection.instructions !== undefined && connection.instructions !== ""
        ? { instructions: connection.instructions }
        : {}),
    };
  }

  private resolveClient(server: string, tool: string): Promise<runtimeTypes.McpServerConnection> {
    return Effect.runPromise(
      Effect.sync(() => {
        const resolved = this.host.findServer(server);
        if (resolved === undefined || !isEnabled(resolved))
          throw new Error(`MCP server "${server}" is disabled.`);
        const client = resolved.connection;
        if (client === undefined) throw new Error(`MCP server "${server}" is still starting.`);
        if (
          getMcpToolExposure(resolved.entry.config, tool) === "hidden" ||
          (client.state === "connected" && !client.tools.some((offered) => offered.name === tool))
        ) {
          throw new Error(`MCP tool "${server}/${tool}" is no longer available.`);
        }
        return client;
      }),
    );
  }

  readonly registerTools = (connection: runtimeTypes.McpServerConnection) => {
    const server = connection.entry.name;
    const entry = this.host.findServer(server)?.entry ?? connection.entry;
    const namespace = this.toolNamespace(connection, entry);
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
        getClient: () => this.resolveClient(server, tool.name),
        name: assignName(tool.name, `${server}\0${tool.name}`),
        namespace,
        readableResources: () =>
          this.resourceTools.resourceServers().some((candidate) => candidate.name === server),
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
    this.resourceTools.syncResourceTools();
  };

  readonly hideTools = (server: string) => {
    for (const name of this.serverTools.get(server) ?? []) {
      const definition = this.definitions.get(name);
      if (definition !== undefined)
        this.host.msa.registerTool({ ...definition, exposure: "hidden" });
    }
    this.serverTools.set(server, new Set());
    this.resourceTools.syncResourceTools();
  };
}

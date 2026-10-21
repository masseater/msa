import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import type extensionTypes from "../extension.types.ts";
import toolsModule from "../tools.ts";
import McpCommand from "./command.ts";
import McpConnections from "./connections.ts";
import McpExtensionState from "./host-state.ts";
import McpMenus from "./menus.ts";
import McpServerActions from "./server-actions.ts";
import McpSessionEvents from "./session-events.ts";
import McpToolRegistry from "./tool-registry.ts";

const { createMcpToolRenderers } = toolsModule;

export default class McpExtensionHost {
  readonly state: McpExtensionState;
  readonly tools: McpToolRegistry;
  readonly actions: McpServerActions;
  readonly menus: McpMenus;
  readonly command: McpCommand;
  readonly events: McpSessionEvents;
  readonly connections: McpConnections;

  register(): void {
    this.state.msa.registerToolRenderer((toolName, next) => {
      const match = /^mcp__(.+?)__(.+)$/u.exec(toolName);
      return (
        next() ?? (match === null ? undefined : createMcpToolRenderers(`${match[1]}/${match[2]}`))
      );
    });

    this.state.msa.on("session_start", (_event, ctx) => this.events.onSessionStart(ctx));

    this.state.msa.on("before_agent_start", (event, ctx) =>
      this.events.onBeforeAgentStart(event, ctx),
    );

    this.state.msa.on("tool_call", (event, ctx) => this.events.onToolCall(event, ctx));

    this.state.msa.on("turn_start", (_event, ctx) => this.events.onTurnStart(ctx));

    this.state.msa.on("mcp_servers_change", (_event, ctx) => this.events.onServersChange(ctx));

    this.state.msa.on("session_shutdown", () => this.events.onSessionShutdown());

    this.state.msa.registerCommand("mcp", {
      description: "Manage MCP servers: sign in, reconnect, enable or disable, and change exposure",
      getArgumentCompletions: (prefix) => this.command.completeMcpCommand(prefix),
      handler: (args, ctx) => this.command.runMcpCommand(args, ctx),
    });
  }

  constructor(msa: extensionsTypesTypes.ExtensionAPI, options: extensionTypes.McpExtensionOptions) {
    this.state = new McpExtensionState(msa, options);
    this.tools = new McpToolRegistry(this);
    this.actions = new McpServerActions(this);
    this.menus = new McpMenus(this);
    this.command = new McpCommand(this);
    this.events = new McpSessionEvents(this);
    this.connections = new McpConnections(this);
  }
}

import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import toolModule from "../../codemode/tool.ts";
import toolSearchTool from "../../tool-search/tool.ts";
import type configTypes from "../config.types.ts";
import type McpExtensionHost from "./host.ts";
import serverState from "./server-state.ts";

const { configuredExposures, isEnabled } = serverState;
const { CODEMODE_TOOL_NAME } = toolModule;
const { TOOL_SEARCH_TOOL_NAME } = toolSearchTool;

export default class McpToolDiscovery {
  private readonly host: McpExtensionHost;

  constructor(host: McpExtensionHost) {
    this.host = host;
  }

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

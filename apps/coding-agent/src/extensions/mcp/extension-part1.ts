import srcConfig from "../../config.ts";
import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import mcpServers from "../../core/mcp-servers.ts";
import configModule from "./config.ts";
import type configTypes from "./config.types.ts";
import type extensionInternalTypes from "./extension-internal.types.ts";
import type extensionTypes from "./extension.types.ts";
import resources from "./resources.ts";

const { LIST_MCP_RESOURCES_TOOL, LIST_MCP_RESOURCE_TEMPLATES_TOOL, READ_MCP_RESOURCE_TOOL } =
  resources;
const { mcpNamespace } = mcpServers;
const { loadMcpConfig } = configModule;
const { getAgentDir } = srcConfig;

const DEFAULT_STARTUP_WAIT_MS = 10_000;

const RESOURCE_TOOL_NAMES: ReadonlySet<string> = new Set([
  LIST_MCP_RESOURCES_TOOL,
  LIST_MCP_RESOURCE_TEMPLATES_TOOL,
  READ_MCP_RESOURCE_TOOL,
]);

const EXPOSURE_DESCRIPTIONS: Record<Exclude<configTypes.McpExposure, "hidden">, string> = {
  codemode: "called from codemode scripts, which find them with searchTools()",
  deferred: "not declared until tool_search loads them, then called directly; no codemode needed",
  direct: "declared to the model like built-in tools",
};

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? "";
}

function isEnabled(server: Pick<extensionInternalTypes.McpServer, "entry">): boolean {
  return server.entry.config.enabled !== false;
}

function exposureOf(entry: configTypes.McpServerEntry): configTypes.McpExposure {
  return entry.config.exposure ?? "codemode";
}

function configuredExposures(entry: configTypes.McpServerEntry): Set<configTypes.McpExposure> {
  return new Set([exposureOf(entry), ...Object.values(entry.config.toolExposure ?? {})]);
}

function hasDirectTools(entry: configTypes.McpServerEntry): boolean {
  return configuredExposures(entry).has("direct");
}

function hasIndirectTools(entry: configTypes.McpServerEntry): boolean {
  const exposures = configuredExposures(entry);
  return exposures.has("codemode") || exposures.has("deferred");
}

const MCP_SERVERS_SECTION = "mcp_servers";

const MAX_SERVER_DESCRIPTION_CHARS = 250;

const MAX_SERVERS_SECTION_CHARS = 4096;

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

function serverSummary(server: extensionTypes.McpServerListing): string {
  const text = server.entry.config.description?.trim() || server.connection?.instructions || "";
  return (text.split("\n", 1)[0] ?? "").trim();
}

function renderServersSection(
  servers: readonly extensionTypes.McpServerListing[],
): string | undefined {
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

function describeState(server: extensionInternalTypes.McpServer, withError = true): string {
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

function attentionRank(server: extensionInternalTypes.McpServer): number {
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

function describeTransport(entry: configTypes.McpServerEntry): string {
  const { config } = entry;
  if ("url" in config) return config.url;
  return [config.command, ...(config.args ?? [])].join(" ");
}

const MCP_USAGE = "Usage: /mcp, /mcp login [server], /mcp logout [server], /mcp reconnect [server]";

function defaultLoadConfig(
  ctx: extensionsTypesTypes.ExtensionContext,
): configTypes.LoadedMcpConfig {
  return loadMcpConfig({
    agentDir: getAgentDir(),
    cwd: ctx.cwd,
    projectTrusted: ctx.isProjectTrusted(),
  });
}

const extensionPart1 = {
  DEFAULT_STARTUP_WAIT_MS,
  EXPOSURE_DESCRIPTIONS,
  MAX_SERVERS_SECTION_CHARS,
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
};

export default extensionPart1;

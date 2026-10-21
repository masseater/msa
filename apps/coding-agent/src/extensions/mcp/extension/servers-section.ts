import mcpServers from "../../../core/mcp-servers.ts";
import type extensionTypes from "../extension.types.ts";
import serverState from "./server-state.ts";

const { mcpNamespace } = mcpServers;
const { configuredExposures, hasIndirectTools, isEnabled } = serverState;

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

const serversSection = { MAX_SERVERS_SECTION_CHARS, MCP_SERVERS_SECTION, renderServersSection };

export default serversSection;

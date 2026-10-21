import type configTypes from "../config.types.ts";
import type extensionInternalTypes from "../extension-internal.types.ts";

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

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? "";
}

const EXPOSURE_DESCRIPTIONS: Record<Exclude<configTypes.McpExposure, "hidden">, string> = {
  codemode: "called from codemode scripts, which find them with searchTools()",
  deferred: "not declared until tool_search loads them, then called directly; no codemode needed",
  direct: "declared to the model like built-in tools",
};

const serverState = {
  EXPOSURE_DESCRIPTIONS,
  attentionRank,
  configuredExposures,
  describeState,
  describeTransport,
  exposureOf,
  firstLine,
  hasDirectTools,
  hasIndirectTools,
  isEnabled,
};

export default serverState;

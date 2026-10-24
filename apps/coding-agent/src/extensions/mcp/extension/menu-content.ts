import type tuiTypes from "@msa/tui/index.types";

import srcConfig from "../../../config.ts";
import platform from "../../../core/platform/index.ts";
import type extensionInternalTypes from "../extension-internal.types.ts";
import type uiTypes from "../ui.types.ts";
import type McpExtensionState from "./host-state.ts";
import serverState from "./server-state.ts";

const { describeState, describeTransport, exposureOf, isEnabled } = serverState;
const { resolve } = platform;
const { getAgentDir } = srcConfig;

type Server = extensionInternalTypes.McpServer;

function savedDescription(entry: Server["entry"]): string {
  return entry.scope === "extension"
    ? "for this session"
    : entry.override !== undefined && entry.override !== ""
      ? "saved to the project mcp.json"
      : entry.scope === undefined
        ? "saved to mcp.json"
        : `saved to the ${entry.scope === "builtin" ? "global" : entry.scope} mcp.json`;
}

function connectionItems(server: Server): tuiTypes.SelectItem[] {
  const { connection } = server;
  const state = connection?.state;
  const items: tuiTypes.SelectItem[] = [];
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
  return items;
}

function menuItems(server: Server, hasProjectConfig: boolean): tuiTypes.SelectItem[] {
  const { entry } = server;
  const saved = savedDescription(entry);
  const inProject =
    (entry.scope === "global" || entry.scope === "builtin") &&
    (entry.override === undefined || entry.override === "") &&
    hasProjectConfig;
  const inProjectSaved = "saved to the project mcp.json";
  if (!isEnabled(server)) {
    return [
      { description: saved, label: "Enable", value: "enable" },
      ...(inProject
        ? [
            {
              description: inProjectSaved,
              label: "Enable in this project",
              value: "enable-project",
            },
          ]
        : []),
    ];
  }
  return [
    ...connectionItems(server),
    ...(entry.scope === "builtin"
      ? []
      : [{ description: exposureOf(entry), label: "Exposure", value: "exposure" }]),
    { description: saved, label: "Disable", value: "disable" },
    ...(inProject
      ? [
          {
            description: inProjectSaved,
            label: "Disable in this project",
            value: "disable-project",
          },
        ]
      : []),
  ];
}

function buildServerMenu(
  server: Server | undefined,
  name: string,
  hasProjectConfig: boolean,
): uiTypes.McpMenu {
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
  const items = menuItems(server, hasProjectConfig);
  const details = [
    describeTransport(entry),
    `${entry.scope ?? "config"}: ${entry.source}`,
    ...(entry.override !== undefined && entry.override !== ""
      ? [`project override: ${entry.override}`]
      : []),
    `State: ${describeState(server, false)}`,
  ];
  const error = [server.message, connection?.state === "connected" ? undefined : connection?.error]
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
}

function noServersMessage(): string {
  return `No MCP servers configured. Add them to ${resolve(getAgentDir(), "mcp.json")} or .msa/mcp.json.`;
}

function formatStatus(
  host: Pick<McpExtensionState, "servers" | "configErrors" | "overridden">,
): string {
  if (host.servers.length === 0 && host.configErrors.length === 0 && host.overridden.length === 0) {
    return noServersMessage();
  }
  const lines = host.servers.map((server) => {
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
  for (const error of host.configErrors) lines.push(`config error: ${error}`);
  for (const line of host.overridden) lines.push(`overridden: ${line}`);
  return lines.join("\n");
}

const menuContent = { buildServerMenu, formatStatus, noServersMessage };

export default menuContent;

import type tuiTypes from "@msa/tui/index.types";
import * as Effect from "effect/Effect";

import srcConfig from "../../../config.ts";
import awaitingModule from "../../../core/awaiting.ts";
import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import platformNode from "../../../core/platform-node.ts";
import configModule from "../config.ts";
import type configTypes from "../config.types.ts";
import type extensionInternalTypes from "../extension-internal.types.ts";
import extensionPart1 from "../extension-part1.ts";
import type uiTypes from "../ui.types.ts";
import type McpExtensionHost from "./host.ts";

const {
  EXPOSURE_DESCRIPTIONS,
  attentionRank,
  describeState,
  describeTransport,
  exposureOf,
  firstLine,
  isEnabled,
} = extensionPart1;
const { getMcpToolExposure } = configModule;
const { resolve } = platformNode;
const { getAgentDir } = srcConfig;
const { awaited, awaiting, awaitingWith } = awaitingModule;

export default class McpMenus {
  private readonly host: McpExtensionHost;

  constructor(host: McpExtensionHost) {
    this.host = host;
  }

  readonly notices = () => [
    ...this.host.configErrors.map((error) => `config: ${error}`),
    ...this.host.overridden.map((line) => `overridden: ${line}`),
  ];

  readonly serversMenu = (): uiTypes.McpMenu => ({
    cancelLabel: "close",
    confirmLabel: "manage",
    empty: `No MCP servers configured. Add them to ${resolve(getAgentDir(), "mcp.json")} or .msa/mcp.json.`,
    error: this.notices().join("\n") || undefined,
    items: [...this.host.servers]
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
    const server = this.host.findServer(name);
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
      this.host.projectConfig !== undefined;
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
        return this.host.actions.setExposure(server, choice as configTypes.McpExposure);
      }, this),
    );

  readonly runAction = (
    ui: uiTypes.McpUi,
    ctx: extensionsTypesTypes.ExtensionContext,
    server: extensionInternalTypes.McpServer,
    action: string,
  ) =>
    Effect.runPromise(
      awaitingWith(function* () {
        const { signal } = this.host.session;
        let message: string | undefined;
        switch (action) {
          case "signin":
            message = yield* awaited(this.host.actions.signInWithUi(ui, server));
            break;
          case "reconnect":
            this.host.actions.runInBackground(ctx, server, () =>
              Effect.runPromise(
                awaitingWith(function* () {
                  yield* awaited(this.host.actions.reconnect(server));
                  return undefined;
                }, this),
              ),
            );
            break;
          case "signout":
            yield* awaited(this.host.actions.signOut(server));
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
            this.host.actions.runInBackground(ctx, server, () =>
              this.host.actions.setEnabled(server, enable, action.endsWith("-project")),
            );
            break;
          }
        }

        if (signal.aborted) return;
        server.message = message;
        this.host.tools.ensureDiscoveryActive(ctx);
        this.host.emitChange();
      }, this),
    );

  readonly manage = (ui: uiTypes.McpUi, ctx: extensionsTypesTypes.ExtensionContext) =>
    Effect.runPromise(
      awaitingWith(function* () {
        for (;;) {
          const name = yield* awaited(ui.menu(this.serversMenu, this.host.subscribe));
          if (name === undefined || name === "") return;
          for (;;) {
            const action = yield* awaited(
              ui.menu(() => this.serverMenu(name), this.host.subscribe),
            );
            const server = this.host.findServer(name);
            if (action === undefined || action === "" || server === undefined) break;
            yield* awaited(this.runAction(ui, ctx, server, action));
          }
        }
      }, this),
    );

  readonly formatStatus = (): string => {
    if (
      this.host.servers.length === 0 &&
      this.host.configErrors.length === 0 &&
      this.host.overridden.length === 0
    ) {
      return `No MCP servers configured. Add them to ${resolve(getAgentDir(), "mcp.json")} or .msa/mcp.json.`;
    }
    const lines = this.host.servers.map((server) => {
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
    for (const error of this.host.configErrors) lines.push(`config error: ${error}`);
    for (const line of this.host.overridden) lines.push(`overridden: ${line}`);
    return lines.join("\n");
  };
}

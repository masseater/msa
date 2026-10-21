import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import configModule from "../config.ts";
import type configTypes from "../config.types.ts";
import type extensionInternalTypes from "../extension-internal.types.ts";
import type uiTypes from "../ui.types.ts";
import type McpExtensionHost from "./host.ts";
import menuContent from "./menu-content.ts";
import serverState from "./server-state.ts";

const { EXPOSURE_DESCRIPTIONS, attentionRank, describeState, exposureOf, firstLine } = serverState;
const { getMcpToolExposure } = configModule;
const { buildServerMenu, formatStatus, noServersMessage } = menuContent;
const { awaited, awaiting, awaitingWith } = awaitingModule;

export default class McpMenus {
  private readonly host: McpExtensionHost;

  constructor(host: McpExtensionHost) {
    this.host = host;
  }

  readonly notices = () => [
    ...this.host.state.configErrors.map((error) => `config: ${error}`),
    ...this.host.state.overridden.map((line) => `overridden: ${line}`),
  ];

  readonly serversMenu = (): uiTypes.McpMenu => ({
    cancelLabel: "close",
    confirmLabel: "manage",
    empty: noServersMessage(),
    error: this.notices().join("\n") || undefined,
    items: [...this.host.state.servers]
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

  readonly serverMenu = (name: string): uiTypes.McpMenu =>
    buildServerMenu(
      this.host.state.findServer(name),
      name,
      this.host.state.projectConfig !== undefined,
    );

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
        return yield* awaited(
          this.host.actions.setExposure(server, choice as configTypes.McpExposure),
        );
      }, this),
    );

  private performAction(
    ui: uiTypes.McpUi,
    ctx: extensionsTypesTypes.ExtensionContext,
    server: extensionInternalTypes.McpServer,
    action: string,
  ): Promise<string | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        switch (action) {
          case "signin":
            return yield* awaited(this.host.actions.signInWithUi(ui, server));
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
            return yield* awaited(this.chooseExposure(ui, server));
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
        return undefined;
      }, this),
    );
  }

  readonly runAction = (
    ui: uiTypes.McpUi,
    ctx: extensionsTypesTypes.ExtensionContext,
    server: extensionInternalTypes.McpServer,
    action: string,
  ) =>
    Effect.runPromise(
      awaitingWith(function* () {
        const { signal } = this.host.state.session;
        const message = yield* awaited(this.performAction(ui, ctx, server, action));
        if (signal.aborted) return;
        server.message = message;
        this.host.tools.discovery.ensureDiscoveryActive(ctx);
        this.host.state.emitChange();
      }, this),
    );

  readonly manage = (ui: uiTypes.McpUi, ctx: extensionsTypesTypes.ExtensionContext) =>
    Effect.runPromise(
      awaitingWith(function* () {
        for (;;) {
          const name = yield* awaited(ui.menu(this.serversMenu, this.host.state.subscribe));
          if (name === undefined || name === "") return;
          for (;;) {
            const action = yield* awaited(
              ui.menu(() => this.serverMenu(name), this.host.state.subscribe),
            );
            const server = this.host.state.findServer(name);
            if (action === undefined || action === "" || server === undefined) break;
            yield* awaited(this.runAction(ui, ctx, server, action));
          }
        }
      }, this),
    );

  readonly formatStatus = (): string => formatStatus(this.host.state);
}

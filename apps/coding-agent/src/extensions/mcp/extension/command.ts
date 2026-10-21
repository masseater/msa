import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import type extensionInternalTypes from "../extension-internal.types.ts";
import extensionPart1 from "../extension-part1.ts";
import extensionPart2Part1 from "../extension-part2-part1.ts";
import uiModule from "../ui.ts";
import type McpExtensionHost from "./host.ts";

const { MCP_USAGE, describeState } = extensionPart1;
const { awaited, awaitingWith } = awaitingModule;
const { showMcpManager } = uiModule;
const { handlerPart1 } = extensionPart2Part1;

export default class McpCommand {
  private readonly host: McpExtensionHost;

  constructor(host: McpExtensionHost) {
    this.host = host;
  }

  readonly pickServer = (
    name: string | undefined,
    ctx: extensionsTypesTypes.ExtensionCommandContext,
    criteria: {
      eligible: (server: extensionInternalTypes.McpServer) => boolean;
      preferred: (server: extensionInternalTypes.McpServer) => boolean;
      none: string;
    },
  ): Promise<extensionInternalTypes.McpServer | undefined> =>
    Effect.runPromise(
      awaitingWith(function* () {
        if (name !== undefined && name !== "") {
          const server = this.host.findServer(name);
          if (server === undefined) ctx.ui.notify(`No MCP server named "${name}".`, "error");
          else if (!criteria.eligible(server)) ctx.ui.notify(criteria.none, "error");
          return server !== undefined && criteria.eligible(server) ? server : undefined;
        }
        const candidates = this.host.servers.filter(criteria.eligible);
        if (candidates.length === 0) {
          ctx.ui.notify(criteria.none, "info");
          return undefined;
        }
        const preferred = candidates.filter(criteria.preferred);
        if (candidates.length === 1) return candidates[0];
        if (preferred.length === 1) return preferred[0];
        const choice = yield* awaited(
          ctx.ui.select(
            "MCP server",
            candidates.map((server) => server.entry.name),
          ),
        );
        return candidates.find((server) => server.entry.name === choice);
      }, this),
    );

  readonly usesOAuth = (server: extensionInternalTypes.McpServer) =>
    server.connection?.auth.oauthUrl !== undefined;

  readonly oauthPick = {
    eligible: this.usesOAuth,
    none: "No enabled MCP server uses OAuth. Only HTTP servers without an Authorization header do.",
    preferred: (server: extensionInternalTypes.McpServer) =>
      server.connection?.state === "needs-auth",
  };

  readonly loginCommand = (
    server: extensionInternalTypes.McpServer,
    ctx: extensionsTypesTypes.ExtensionCommandContext,
  ) =>
    Effect.runPromise(
      awaitingWith(function* () {
        const { name } = server.entry;
        if (!ctx.hasUI) {
          ctx.ui.notify(`Signing in to MCP server "${name}" requires interactive mode.`, "error");
          return;
        }
        const { signal } = this.host.session;
        let failure: string | undefined;
        if (ctx.mode === "tui") {
          yield* awaited(
            showMcpManager(ctx, (ui) =>
              Effect.runPromise(
                awaitingWith(function* () {
                  failure = yield* awaited(this.host.actions.signInWithUi(ui, server));
                }, this),
              ),
            ),
          );
        } else {
          failure = yield* awaited(
            this.host.actions.signIn(server, {
              promptForRedirectUrl: (promptSignal) =>
                ctx.ui.input(
                  `Waiting for sign-in to "${name}". If the browser cannot reach this machine, paste the URL it was redirected to.`,
                  "http://127.0.0.1:.../callback?code=...",
                  { signal: promptSignal },
                ),
              showAuthorizationUrl: (url) => {
                ctx.ui.notify(
                  `Sign in to MCP server "${name}" in your browser:\n${url.href}`,
                  "info",
                );
                this.host.openUrl(url.href);
              },
            }),
          );
        }

        if (signal.aborted) return;
        if (failure !== undefined && failure !== "") {
          ctx.ui.notify(failure, failure === "Sign-in cancelled." ? "info" : "error");
          return;
        }
        this.host.tools.ensureDiscoveryActive(ctx);
        ctx.ui.notify(
          `Signed in to MCP server "${name}" (${server.connection?.tools.length ?? 0} tools).`,
          "info",
        );
      }, this),
    );

  completeMcpCommand(prefix: string) {
    const [action, server, ...rest] = prefix.trimStart().split(/\s+/u);
    if (rest.length > 0) return null;
    if (server === undefined) {
      return ["login", "logout", "reconnect"]
        .filter((item) => item.startsWith(action ?? ""))
        .map((item) => ({ label: item, value: `${item} ` }));
    }
    if (action !== "login" && action !== "logout" && action !== "reconnect") return null;
    const items = this.host.servers
      .filter((candidate) =>
        action === "reconnect" ? candidate.connection !== undefined : this.usesOAuth(candidate),
      )
      .filter((candidate) => candidate.entry.name.startsWith(server))
      .map((candidate) => ({
        description: describeState(candidate),
        label: candidate.entry.name,
        value: `${action} ${candidate.entry.name}`,
      }));
    return items.length > 0 ? items : null;
  }

  runMcpCommand(args: string, ctx: extensionsTypesTypes.ExtensionCommandContext): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const [action, name, ...extra] = args.trim().split(/\s+/u).filter(Boolean);
        if (action === undefined) {
          if (ctx.mode === "tui")
            yield* awaited(showMcpManager(ctx, (ui) => this.host.menus.manage(ui, ctx)));
          else {
            yield* awaited(this.host.pending);
            ctx.ui.notify(this.host.menus.formatStatus(), "info");
          }
          return;
        }
        if (extra.length > 0) {
          ctx.ui.notify(MCP_USAGE, "warning");
          return;
        }
        yield* awaited(this.host.pending);
        switch (action) {
          case "login": {
            const server = yield* awaited(this.pickServer(name, ctx, this.oauthPick));
            if (server !== undefined) yield* awaited(this.loginCommand(server, ctx));
            return;
          }
          case "logout": {
            const server = yield* awaited(this.pickServer(name, ctx, this.oauthPick));
            if (server === undefined) return;
            const removed = yield* awaited(this.host.actions.signOut(server));
            ctx.ui.notify(
              removed
                ? `Signed out of MCP server "${server.entry.name}".`
                : `No stored credentials for MCP server "${server.entry.name}".`,
              "info",
            );
            return;
          }
          case "reconnect": {
            const server = yield* awaited(
              this.pickServer(name, ctx, {
                eligible: (candidate) => candidate.connection !== undefined,
                none: "No enabled MCP server to reconnect.",
                preferred: (candidate) =>
                  candidate.connection?.state === "failed" ||
                  candidate.connection?.state === "disconnected",
              }),
            );
            if (server === undefined) return;
            return yield* handlerPart1(
              this.host.actions.reconnect,
              server,
              ctx,
              this.host.tools.ensureDiscoveryActive,
            );
          }
          default:
            ctx.ui.notify(MCP_USAGE, "warning");
        }
      }, this),
    );
  }
}

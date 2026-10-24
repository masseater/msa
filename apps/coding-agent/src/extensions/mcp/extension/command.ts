import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import type extensionInternalTypes from "../extension-internal.types.ts";
import uiModule from "../ui.ts";
import type McpExtensionHost from "./host.ts";
import serverState from "./server-state.ts";

const MCP_USAGE = "Usage: /mcp, /mcp login [server], /mcp logout [server], /mcp reconnect [server]";
const { describeState } = serverState;
const { awaited, awaitingWith } = awaitingModule;
const { showMcpManager } = uiModule;

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
          const server = this.host.state.findServer(name);
          if (server === undefined) ctx.ui.notify(`No MCP server named "${name}".`, "error");
          else if (!criteria.eligible(server)) ctx.ui.notify(criteria.none, "error");
          return server !== undefined && criteria.eligible(server) ? server : undefined;
        }
        const candidates = this.host.state.servers.filter(criteria.eligible);
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

  private signInInline(
    server: extensionInternalTypes.McpServer,
    ctx: extensionsTypesTypes.ExtensionCommandContext,
  ): Promise<string | undefined> {
    const { name } = server.entry;
    return this.host.actions.signIn(server, {
      promptForRedirectUrl: (promptSignal) =>
        ctx.ui.input(
          `Waiting for sign-in to "${name}". If the browser cannot reach this machine, paste the URL it was redirected to.`,
          "http://127.0.0.1:.../callback?code=...",
          { signal: promptSignal },
        ),
      showAuthorizationUrl: (url) => {
        ctx.ui.notify(`Sign in to MCP server "${name}" in your browser:\n${url.href}`, "info");
        this.host.state.openUrl(url.href);
      },
    });
  }

  private signInWithManager(
    server: extensionInternalTypes.McpServer,
    ctx: extensionsTypesTypes.ExtensionCommandContext,
  ): Promise<string | undefined> {
    let failure: string | undefined;
    return showMcpManager(ctx, (ui) =>
      this.host.actions.signInWithUi(ui, server).then((result) => {
        failure = result;
        return undefined;
      }),
    ).then(() => failure);
  }

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
        const { signal } = this.host.state.session;
        const failure = yield* awaited(
          ctx.mode === "tui" ? this.signInWithManager(server, ctx) : this.signInInline(server, ctx),
        );
        if (signal.aborted) return;
        if (failure !== undefined && failure !== "") {
          ctx.ui.notify(failure, failure === "Sign-in cancelled." ? "info" : "error");
          return;
        }
        this.host.tools.discovery.ensureDiscoveryActive(ctx);
        const note = yield* awaited(
          this.host.state.credentials?.persistenceNote() ?? Promise.resolve(undefined),
        );
        ctx.ui.notify(
          [
            `Signed in to MCP server "${name}" (${server.connection?.tools.length ?? 0} tools).`,
            ...(note === undefined ? [] : [note]),
          ].join("\n"),
          note === undefined ? "info" : "warning",
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
    const items = this.host.state.servers
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

  private loginAction(
    name: string | undefined,
    ctx: extensionsTypesTypes.ExtensionCommandContext,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const server = yield* awaited(this.pickServer(name, ctx, this.oauthPick));
        if (server !== undefined) yield* awaited(this.loginCommand(server, ctx));
      }, this),
    );
  }

  private logoutAction(
    name: string | undefined,
    ctx: extensionsTypesTypes.ExtensionCommandContext,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const server = yield* awaited(this.pickServer(name, ctx, this.oauthPick));
        if (server === undefined) return;
        const removed = yield* awaited(this.host.actions.signOut(server));
        ctx.ui.notify(
          removed
            ? `Signed out of MCP server "${server.entry.name}".`
            : `No stored credentials for MCP server "${server.entry.name}".`,
          "info",
        );
      }, this),
    );
  }

  private reconnectAction(
    name: string | undefined,
    ctx: extensionsTypesTypes.ExtensionCommandContext,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
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
        const failure = yield* awaited(this.host.actions.reconnect(server));
        if (failure !== undefined && failure !== "") {
          ctx.ui.notify(failure, "error");
          return;
        }
        this.host.tools.discovery.ensureDiscoveryActive(ctx);
        ctx.ui.notify(
          `Reconnected to MCP server "${server.entry.name}" (${describeState(server)}).`,
          "info",
        );
      }, this),
    );
  }

  runMcpCommand(args: string, ctx: extensionsTypesTypes.ExtensionCommandContext): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const [action, name, ...extra] = args.trim().split(/\s+/u).filter(Boolean);
        if (action === undefined) {
          if (ctx.mode === "tui")
            yield* awaited(showMcpManager(ctx, (ui) => this.host.menus.manage(ui, ctx)));
          else {
            yield* awaited(this.host.state.pending);
            ctx.ui.notify(this.host.menus.formatStatus(), "info");
          }
          return;
        }
        if (extra.length > 0) {
          ctx.ui.notify(MCP_USAGE, "warning");
          return;
        }
        yield* awaited(this.host.state.pending);
        if (action === "login") yield* awaited(this.loginAction(name, ctx));
        else if (action === "logout") yield* awaited(this.logoutAction(name, ctx));
        else if (action === "reconnect") yield* awaited(this.reconnectAction(name, ctx));
        else ctx.ui.notify(MCP_USAGE, "warning");
      }, this),
    );
  }
}

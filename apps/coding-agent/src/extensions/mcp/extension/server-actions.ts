import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import errorsModule from "../../../utils/errors.ts";
import type configTypes from "../config.types.ts";
import type extensionInternalTypes from "../extension-internal.types.ts";
import type oauthTypesNs from "../oauth.types.ts";
import runtimeLazy from "../runtime.lazy.ts";
import type uiTypes from "../ui.types.ts";
import type McpExtensionHost from "./host.ts";

const { awaited, awaiting, awaitingWith } = awaitingModule;
const { loadMcpRuntime } = runtimeLazy;
const { toErrorMessage } = errorsModule;

export default class McpServerActions {
  private readonly host: McpExtensionHost;

  constructor(host: McpExtensionHost) {
    this.host = host;
  }

  readonly saveConfig = (
    server: extensionInternalTypes.McpServer,
    patch: configTypes.McpServerConfigPatch,
    inProject = false,
  ): string | undefined => {
    const override = inProject ? this.host.projectConfig : server.entry.override;
    const entry =
      override !== undefined && override !== "" ? { ...server.entry, override } : server.entry;
    if (entry.scope !== "extension") {
      try {
        this.host.updateConfig(entry, patch);
      } catch (error) {
        return `Could not update ${entry.override ?? entry.source}: ${toErrorMessage(error)}`;
      }
    }
    server.entry = { ...entry, config: { ...entry.config, ...patch } };
    return undefined;
  };

  readonly signIn = (
    server: extensionInternalTypes.McpServer,
    prompt: oauthTypesNs.McpSignInPrompt,
    cancel?: AbortSignal,
  ): Promise<string | undefined> =>
    Effect.runPromise(
      awaitingWith(function* () {
        const connection = server.connection;
        const url = connection?.auth.oauthUrl;
        if (connection === undefined || url === undefined || url === "")
          return `MCP server "${server.entry.name}" does not use OAuth.`;
        const runtime = yield* awaited(loadMcpRuntime());
        const signal =
          cancel === undefined
            ? this.host.session.signal
            : AbortSignal.any([this.host.session.signal, cancel]);
        try {
          yield* awaited(
            this.host.track(
              runtime.signInMcpServer({
                challenge: connection.auth.challenge,
                prompt,
                serverUrl: url,
                settings: connection.auth.oauthSettings(),
                signal,
                store: this.host.connections
                  .getCredentials(runtime)
                  .forServer(server.entry.name, url),
              }),
            ),
          );
        } catch (error) {
          if (error instanceof runtime.McpSignInCancelledError) return "Sign-in cancelled.";
          return `Sign-in failed: ${toErrorMessage(error)}`;
        }

        connection.auth.challenge = undefined;
        try {
          yield* awaited(connection.reconnect());
        } catch (error) {
          return `Signed in, but ${toErrorMessage(error)}`;
        }
        return undefined;
      }, this),
    );

  readonly signOut = (server: extensionInternalTypes.McpServer): Promise<boolean> =>
    Effect.runPromise(
      awaitingWith(function* () {
        const connection = server.connection;
        const url = connection?.auth.oauthUrl;
        if (connection === undefined || url === undefined || url === "") return false;
        const removed = this.host.connections
          .getCredentials(yield* awaited(loadMcpRuntime()))
          .remove(server.entry.name, url);
        yield* awaited(connection.signOut());
        return removed;
      }, this),
    );

  readonly reconnect = (server: extensionInternalTypes.McpServer): Promise<string | undefined> =>
    Effect.runPromise(
      awaiting(function* () {
        const connection = server.connection;
        if (connection === undefined) return `MCP server "${server.entry.name}" is disabled.`;
        const previous = server.ready;
        const ready = (() =>
          Effect.runPromise(
            awaiting(function* () {
              yield* awaited(previous);
              yield* awaited(connection.reconnect());
            }),
          ))();
        server.ready = ready.catch(() => undefined);
        try {
          yield* awaited(ready);
          return undefined;
        } catch (error) {
          return toErrorMessage(error);
        }
      }),
    );

  readonly setEnabled = (
    server: extensionInternalTypes.McpServer,
    enabled: boolean,
    inProject = false,
  ): Promise<string | undefined> =>
    Effect.runPromise(
      awaitingWith(function* () {
        const failed = this.saveConfig(server, { enabled }, inProject);
        if (failed !== undefined && failed !== "") return failed;
        if (!enabled) {
          const connection = server.connection;
          server.attempt = undefined;
          server.connection = undefined;
          if (connection !== undefined) {
            server.closing = Promise.all([connection.close(), server.ready]).then(() => undefined);
          }
          const closing = server.closing;
          this.host.tools.hideTools(server.entry.name);
          this.host.emitChange();
          try {
            yield* awaited(closing);
          } finally {
            if (server.closing === closing) server.closing = undefined;
          }
          return undefined;
        }
        yield* awaited(this.host.connections.startConnection(server, server.closing));
        return undefined;
      }, this),
    );

  readonly setExposure = (
    server: extensionInternalTypes.McpServer,
    exposure: configTypes.McpExposure,
  ): string | undefined => {
    const failed = this.saveConfig(server, { exposure });
    if (failed !== undefined && failed !== "") return failed;
    if (server.connection?.state === "connected") this.host.tools.registerTools(server.connection);
    this.host.tools.syncResourceTools();

    const indirect = new Set(
      this.host.msa
        .getAllTools()
        .filter((tool) => tool.exposure !== "direct")
        .map((tool) => tool.name),
    );
    const tools = this.host.tools.serverTools.get(server.entry.name) ?? new Set<string>();
    this.host.msa.setActiveTools(
      this.host.msa.getActiveTools().filter((name) => !tools.has(name) || !indirect.has(name)),
    );
    this.host.emitChange();
    return undefined;
  };

  readonly signInWithUi = (
    ui: uiTypes.McpUi,
    server: extensionInternalTypes.McpServer,
  ): Promise<string | undefined> => {
    const title = `Sign in to ${server.entry.name}`;
    const cancel = new AbortController();
    const status = (message: string) => ui.status(title, message, () => cancel.abort());
    let authorizationUrl = "";
    status("Contacting the authorization server…");
    return this.signIn(
      server,
      {
        promptForRedirectUrl: (signal) =>
          Effect.runPromise(
            awaiting(function* () {
              const value = yield* awaited(ui.redirectUrl(title, authorizationUrl, signal));
              status("Connecting…");
              return value;
            }),
          ),
        showAuthorizationUrl: (url) => {
          authorizationUrl = url.href;
          this.host.openUrl(url.href);
        },
      },
      cancel.signal,
    );
  };

  readonly runInBackground = (
    ctx: extensionsTypesTypes.ExtensionContext,
    server: extensionInternalTypes.McpServer,
    operation: () => Promise<string | undefined>,
  ) => {
    const ready = operation();
    const attempt = server.attempt;
    const { signal } = this.host.session;
    const finish = (message: string | undefined) => {
      if (signal.aborted || server.attempt !== attempt || !this.host.servers.includes(server))
        return;
      server.message = message;
      this.host.tools.ensureDiscoveryActive(ctx);
      this.host.emitChange();
    };
    void this.host.track(ready.then(finish, (error: unknown) => finish(toErrorMessage(error))));
  };
}

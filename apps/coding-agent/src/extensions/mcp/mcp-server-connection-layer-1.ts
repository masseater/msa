import mcp from "@msa/mcp";
import type mcpTypes from "@msa/mcp/index.types";
import oauthModule from "@msa/mcp/oauth";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import resolveConfigValueModule from "../../core/resolve-config-value.ts";
import errors from "../../utils/errors.ts";
import mcpServerConnectionHelpers from "./mcp-server-connection-helpers.ts";
import McpServerConnectionLayer0 from "./mcp-server-connection-layer-0.ts";
import type McpServerConnection from "./mcp-server-connection.ts";
import type oauthTypesNs from "./oauth.types.ts";

const { resolveConfigValueOrThrow } = resolveConfigValueModule;
const { awaited, awaitingWith } = awaitingModule;
const { McpOAuthAuthorizationRequiredError } = oauthModule;
const { McpAuthRequiredError } = mcp;
const { toErrorMessage } = errors;
const { DEFAULT_TIMEOUT_SECONDS, STDERR_TAIL_CHARS, signInRequiredMessage, usesOAuth } =
  mcpServerConnectionHelpers;

export default abstract class McpServerConnectionLayer1 extends McpServerConnectionLayer0 {
  get name(): string {
    return this.entry.name;
  }

  protected get closed(): boolean {
    return this.shutdown.signal.aborted;
  }

  get timeoutMs(): number {
    return (this.entry.config.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
  }

  get oauthUrl(): string | undefined {
    return usesOAuth(this.entry) && "url" in this.entry.config ? this.entry.config.url : undefined;
  }

  oauthSettings(): oauthTypesNs.McpOAuthSettings {
    const oauth = "url" in this.entry.config ? this.entry.config.oauth : undefined;
    if (oauth === undefined) return {};
    return {
      authServerMetadataUrl:
        oauth.authServerMetadataUrl !== undefined && oauth.authServerMetadataUrl !== ""
          ? new URL(oauth.authServerMetadataUrl)
          : undefined,
      callbackPort: oauth.callbackPort,
      callbackUrl: oauth.callbackUrl,
      clientId: oauth.clientId,
      clientName: oauth.clientName,
      clientRegistration: oauth.clientRegistration,
      clientSecret:
        oauth.clientSecret === undefined
          ? undefined
          : resolveConfigValueOrThrow(
              oauth.clientSecret,
              `MCP server "${this.entry.name}" oauth.clientSecret`,
            ),
      scope: oauth.scope,
    };
  }

  signOut(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(
        function* () {
          yield* awaited(this.opening?.catch(() => undefined));
          if (this.client !== undefined) yield* awaited(this.dropClient(this.client));
          if (!this.closed) this.markNeedsAuth();
        },
        this as unknown as McpServerConnection,
      ),
    );
  }

  protected needsSignIn(error: unknown): boolean {
    return (
      error instanceof McpOAuthAuthorizationRequiredError ||
      (this.authProvider !== undefined && error instanceof McpAuthRequiredError)
    );
  }

  protected markNeedsAuth(): void {
    this.state = "needs-auth";
    this.error = undefined;
    this.changed();
  }

  protected changed(): void {
    this.onChange?.(this as unknown as McpServerConnection);
  }

  protected dropClient(client: mcpTypes.McpClient): Promise<void> {
    return Effect.runPromise(
      awaitingWith(
        function* () {
          if (this.client === client) this.client = undefined;
          yield* awaited(client.close().catch(() => undefined));
        },
        this as unknown as McpServerConnection,
      ),
    );
  }

  protected *connectOncePart1(
    client: mcpTypes.McpClient,
    stdio: mcpTypes.StdioTransport | undefined,
  ): Generator<Effect.Effect<unknown>, mcpTypes.Tool[], unknown> {
    client.onClose(() => this.handleClientClose(client, stdio));

    const tools =
      client.serverCapabilities?.tools === undefined ? [] : yield* awaited(client.listTools());
    if (this.closed) throw new Error("shut down while connecting");
    if (client.connectionState !== "connected") throw new Error("connection closed during setup");
    return tools;
  }

  protected connectFailed(error: unknown): Error {
    if (this.needsSignIn(error) && !this.closed) {
      this.markNeedsAuth();
      return new Error(signInRequiredMessage(this.entry));
    }
    this.state = this.closed ? "closed" : "failed";
    this.error =
      this.stderrTail !== undefined && this.stderrTail !== ""
        ? `${toErrorMessage(error)}\n${this.stderrTail}`
        : toErrorMessage(error);
    this.changed();
    return new Error(`MCP server "${this.entry.name}" failed to connect: ${this.error}`);
  }

  protected handleClientClose(
    client: mcpTypes.McpClient,
    stdio: mcpTypes.StdioTransport | undefined,
  ): void {
    if (this.client !== client || this.closed) return;
    this.client = undefined;
    this.state = "disconnected";
    const stderr = stdio?.stderr.trim().slice(-STDERR_TAIL_CHARS);
    this.error =
      stderr !== undefined && stderr !== "" ? `Connection closed\n${stderr}` : "Connection closed";
    this.changed();
  }

  protected refreshTools(client: mcpTypes.McpClient): Promise<void> {
    return Effect.runPromise(
      awaitingWith(
        function* () {
          try {
            const tools = yield* awaited(client.listTools());
            if (this.client !== client || this.closed) return;
            this.tools = tools;
            this.onTools(this as unknown as McpServerConnection);
          } catch (error) {
            this.error = `Failed to refresh tools: ${toErrorMessage(error)}`;
          }
          this.changed();
        },
        this as unknown as McpServerConnection,
      ),
    );
  }

  close(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(
        function* () {
          this.shutdown.abort();
          this.state = "closed";
          this.changed();
          const client = this.client;
          this.client = undefined;
          yield* awaited(
            Promise.all([
              client?.close().catch(() => undefined),
              this.opening?.catch(() => undefined),
            ]),
          );

          yield* awaited(this.authProvider?.settled());
        },
        this as unknown as McpServerConnection,
      ),
    );
  }
}

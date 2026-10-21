import mcp from "@msa/mcp";
import type mcpTypes from "@msa/mcp/index.types";
import oauthModule from "@msa/mcp/oauth";
import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import errors from "../../../utils/errors.ts";
import mcpServerConnectionHelpers from "../mcp-server-connection-helpers.ts";
import type McpServerConnection from "../mcp-server-connection.ts";
import createMcpClient from "./create-mcp-client.ts";

const { awaited, awaitingWith } = awaitingModule;
const { McpOAuthAuthorizationRequiredError } = oauthModule;
const { McpAuthRequiredError, StdioTransport } = mcp;
const { toErrorMessage } = errors;
const { STDERR_TAIL_CHARS, signInRequiredMessage, CONNECT_RETRY_DELAYS_MS, isTransientError } =
  mcpServerConnectionHelpers;

export default class McpConnectionLifecycle {
  private readonly connection: McpServerConnection;

  constructor(connection: McpServerConnection) {
    this.connection = connection;
  }

  needsSignIn(error: unknown): boolean {
    return (
      error instanceof McpOAuthAuthorizationRequiredError ||
      (this.connection.auth.authProvider !== undefined && error instanceof McpAuthRequiredError)
    );
  }

  markNeedsAuth(): void {
    this.connection.state = "needs-auth";
    this.connection.error = undefined;
    this.connection.changed();
  }

  dropClient(client: mcpTypes.McpClient): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.client === client) this.client = undefined;
        yield* awaited(client.close().catch(() => undefined));
      }, this.connection),
    );
  }

  private *watchClient(
    client: mcpTypes.McpClient,
    stdio: mcpTypes.StdioTransport | undefined,
  ): Generator<Effect.Effect<unknown>, mcpTypes.Tool[], unknown> {
    client.onClose(() => this.handleClientClose(client, stdio));

    const tools =
      client.serverCapabilities?.tools === undefined ? [] : yield* awaited(client.listTools());
    if (this.connection.closed) throw new Error("shut down while connecting");
    if (client.connectionState !== "connected") throw new Error("connection closed during setup");
    return tools;
  }

  private connectFailed(error: unknown): Error {
    if (this.needsSignIn(error) && !this.connection.closed) {
      this.markNeedsAuth();
      return new Error(signInRequiredMessage(this.connection.entry));
    }
    this.connection.state = this.connection.closed ? "closed" : "failed";
    this.connection.error =
      this.connection.stderrTail !== undefined && this.connection.stderrTail !== ""
        ? `${toErrorMessage(error)}\n${this.connection.stderrTail}`
        : toErrorMessage(error);
    this.connection.changed();
    return new Error(
      `MCP server "${this.connection.entry.name}" failed to connect: ${this.connection.error}`,
    );
  }

  private handleClientClose(
    client: mcpTypes.McpClient,
    stdio: mcpTypes.StdioTransport | undefined,
  ): void {
    if (this.connection.client !== client || this.connection.closed) return;
    this.connection.client = undefined;
    this.connection.state = "disconnected";
    const stderr = stdio?.stderr.trim().slice(-STDERR_TAIL_CHARS);
    this.connection.error =
      stderr !== undefined && stderr !== "" ? `Connection closed\n${stderr}` : "Connection closed";
    this.connection.changed();
  }

  private refreshTools(client: mcpTypes.McpClient): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          const tools = yield* awaited(client.listTools());
          if (this.client !== client || this.closed) return;
          this.tools = tools;
          this.onTools(this);
        } catch (error) {
          this.error = `Failed to refresh tools: ${toErrorMessage(error)}`;
        }
        this.changed();
      }, this.connection),
    );
  }

  open(): Promise<mcpTypes.McpClient> {
    return Effect.runPromise(
      awaitingWith(function* () {
        this.state = "connecting";
        this.changed();
        const retries = "url" in this.entry.config ? CONNECT_RETRY_DELAYS_MS : [];
        for (let attempt = 0; ; attempt++) {
          this.stderrTail = undefined;
          try {
            return yield* awaited(this.lifecycle.connectOnce());
          } catch (error) {
            const delay = retries[attempt];
            if (this.closed || delay === undefined || !isTransientError(error)) {
              throw this.lifecycle.connectFailed(error);
            }
            yield* awaited(
              Effect.runPromise(Effect.sleep(delay), { signal: this.shutdown.signal }).catch(
                () => undefined,
              ),
            );
            if (this.closed) throw this.lifecycle.connectFailed(error);
          }
        }
      }, this.connection),
    );
  }

  private connectOnce(): Promise<mcpTypes.McpClient> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const client = createMcpClient(this);

        let closing: Promise<void> | undefined;
        const closeClient = () => {
          closing ??= client.close().catch(() => undefined);
          return closing;
        };
        this.shutdown.signal.addEventListener("abort", closeClient, { once: true });
        let transport: mcpTypes.McpTransport | undefined;
        try {
          transport = this.createTransport(this.entry, this.cwd, this.auth.authProvider);
          yield* awaited(client.connect(transport));
          client.onNotification("notifications/tools/list_changed", () => {
            void this.lifecycle.refreshTools(client);
          });
          const stdio = transport instanceof StdioTransport ? transport : undefined;
          const tools = yield* this.lifecycle.watchClient(client, stdio);
          this.client = client;
          this.tools = tools;
          this.hasResources = client.serverCapabilities?.resources !== undefined;
          this.instructions = client.instructions?.trim() || undefined;
          this.state = "connected";
          this.error = undefined;
          this.onTools(this);
          this.changed();
          return client;
        } catch (error) {
          yield* awaited(closeClient());
          if (transport instanceof StdioTransport) {
            this.stderrTail = transport.stderr.trim().slice(-STDERR_TAIL_CHARS) || undefined;
          }
          throw error;
        } finally {
          this.shutdown.signal.removeEventListener("abort", closeClient);
        }
      }, this.connection),
    );
  }
}

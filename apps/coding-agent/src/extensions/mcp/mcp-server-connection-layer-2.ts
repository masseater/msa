import { pathToFileURL } from "node:url";

import mcp from "@msa/mcp";
import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";

import configModule from "../../config.ts";
import awaitingModule from "../../core/awaiting.ts";
import platformNode from "../../core/platform-node.ts";
import mcpServerConnectionHelpers from "./mcp-server-connection-helpers.ts";
import McpServerConnectionLayer1 from "./mcp-server-connection-layer-1.ts";
import type McpServerConnection from "./mcp-server-connection.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { McpClient, McpHttpError, McpSessionExpiredError, StdioTransport } = mcp;
const { basename } = platformNode;
const { VERSION } = configModule;
const {
  CONNECT_RETRY_DELAYS_MS,
  STDERR_TAIL_CHARS,
  isTransientError,
  listTemplates,
  signInRequiredMessage,
  withoutTemplates,
} = mcpServerConnectionHelpers;

export default abstract class McpServerConnectionLayer2 extends McpServerConnectionLayer1 {
  getClient(): Promise<mcpTypes.McpClient> {
    if (this.closed)
      return Promise.reject(new Error(`MCP server "${this.entry.name}" is shut down`));
    if (this.client?.connectionState === "connected") return Promise.resolve(this.client);
    this.opening ??= this.open().finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }

  callTool(
    name: string,
    args: Record<string, unknown>,
    options: mcpTypes.McpRequestOptions,
  ): Promise<mcpTypes.CallToolResult> {
    return this.withClient((client) => client.callTool(name, args, options));
  }

  readResource(
    uri: string,
    options: mcpTypes.McpRequestOptions,
  ): Promise<mcpTypes.ReadResourceResult> {
    return this.withClient((client) => client.readResource(uri, options), true);
  }

  resourcesPage(
    cursor: string | undefined,
    options: mcpTypes.McpRequestOptions,
  ): Promise<mcpTypes.ListResourcesResult> {
    return this.withClient((client) => client.listResourcesPage(cursor, options), true);
  }

  resourceTemplatesPage(
    cursor: string | undefined,
    options: mcpTypes.McpRequestOptions,
  ): Promise<mcpTypes.ListResourceTemplatesResult> {
    return this.withClient(
      (client) =>
        withoutTemplates(() => client.listResourceTemplatesPage(cursor, options), {
          resourceTemplates: [],
        }),
      true,
    );
  }

  allResources(options: mcpTypes.McpRequestOptions): Promise<mcpTypes.Resource[]> {
    return this.withClient((client) => client.listResources(options), true);
  }

  allResourceTemplates(options: mcpTypes.McpRequestOptions): Promise<mcpTypes.ResourceTemplate[]> {
    return this.withClient((client) => listTemplates(client, options), true);
  }

  protected withClient<T>(
    run: (client: mcpTypes.McpClient) => Promise<T>,
    readOnly = false,
  ): Promise<T> {
    return Effect.runPromise(
      awaitingWith(
        function* () {
          for (let attempt = 1; ; attempt++) {
            const client = yield* awaited(this.getClient());
            try {
              return yield* awaited(run(client));
            } catch (error) {
              if (
                readOnly &&
                attempt === 1 &&
                error instanceof McpHttpError &&
                isTransientError(error)
              ) {
                yield* performed(Effect.sleep(CONNECT_RETRY_DELAYS_MS[0] ?? 0));
                continue;
              }
              if (error instanceof McpSessionExpiredError && attempt === 1) {
                if (this.client === client) this.client = undefined;
                continue;
              }
              if (!this.needsSignIn(error)) throw error;
              yield* awaited(this.dropClient(client));
              this.markNeedsAuth();
              throw new Error(signInRequiredMessage(this.entry), { cause: error });
            }
          }
        },
        this as unknown as McpServerConnection,
      ),
    );
  }

  reconnect(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(
        function* () {
          yield* awaited(this.opening?.catch(() => undefined));
          if (this.client !== undefined) yield* awaited(this.dropClient(this.client));
          yield* awaited(this.getClient());
        },
        this as unknown as McpServerConnection,
      ),
    );
  }

  protected open(): Promise<mcpTypes.McpClient> {
    return Effect.runPromise(
      awaitingWith(
        function* () {
          this.state = "connecting";
          this.changed();
          const retries = "url" in this.entry.config ? CONNECT_RETRY_DELAYS_MS : [];
          for (let attempt = 0; ; attempt++) {
            this.stderrTail = undefined;
            try {
              return yield* awaited(this.connectOnce());
            } catch (error) {
              const delay = retries[attempt];
              if (this.closed || delay === undefined || !isTransientError(error)) {
                throw this.connectFailed(error);
              }
              yield* awaited(
                Effect.runPromise(Effect.sleep(delay), { signal: this.shutdown.signal }).catch(
                  () => undefined,
                ),
              );
              if (this.closed) throw this.connectFailed(error);
            }
          }
        },
        this as unknown as McpServerConnection,
      ),
    );
  }

  protected connectOnce(): Promise<mcpTypes.McpClient> {
    return Effect.runPromise(
      awaitingWith(
        function* () {
          const client = new McpClient({
            name: "msa",
            requestTimeoutMs: this.timeoutMs,
            roots: [{ name: basename(this.cwd), uri: pathToFileURL(this.cwd).href }],
            version: VERSION,
          });
          const log = this.log;
          if (log !== undefined)
            client.onNotification("notifications/message", (params) =>
              log.write(this.entry.name, params),
            );

          let closing: Promise<void> | undefined;
          const closeClient = () => {
            closing ??= client.close().catch(() => undefined);
            return closing;
          };
          this.shutdown.signal.addEventListener("abort", closeClient, { once: true });
          let transport: mcpTypes.McpTransport | undefined;
          try {
            transport = this.createTransport(this.entry, this.cwd, this.authProvider);
            yield* awaited(client.connect(transport));
            client.onNotification("notifications/tools/list_changed", () => {
              void this.refreshTools(client);
            });
            const stdio = transport instanceof StdioTransport ? transport : undefined;
            const tools = yield* this.connectOncePart1(client, stdio);
            this.client = client;
            this.tools = tools;
            this.hasResources = client.serverCapabilities?.resources !== undefined;
            this.instructions = client.instructions?.trim() || undefined;
            this.state = "connected";
            this.error = undefined;
            this.onTools(this as unknown as McpServerConnection);
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
        },
        this as unknown as McpServerConnection,
      ),
    );
  }
}

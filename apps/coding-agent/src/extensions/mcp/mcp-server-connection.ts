import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import mcpServerConnectionHelpers from "./mcp-server-connection-helpers.ts";
import type mcpServerConnectionInternalTypes from "./mcp-server-connection-internal.types.ts";
import McpConnectionAuth from "./mcp-server-connection/connection-auth.ts";
import McpConnectionLifecycle from "./mcp-server-connection/connection-lifecycle.ts";
import McpRequests from "./mcp-server-connection/connection-requests.ts";
import type resourcesTypes from "./resources.types.ts";
import type toolsTypes from "./tools.types.ts";
const { awaited, awaitingWith } = awaitingModule;
const { DEFAULT_TIMEOUT_SECONDS } = mcpServerConnectionHelpers;

type Options = mcpServerConnectionInternalTypes.ConnectionOptions;

export default class McpServerConnection
  implements toolsTypes.McpToolCaller, resourcesTypes.McpResourceServer
{
  readonly lifecycle: McpConnectionLifecycle;
  readonly requests: McpRequests;
  readonly auth: McpConnectionAuth;

  entry!: Options["entry"];

  state: mcpServerConnectionInternalTypes.ServerState = "connecting";

  error!: string | undefined;

  tools: mcpTypes.Tool[] = [];

  hasResources = false;

  instructions!: string | undefined;

  client!: mcpTypes.McpClient | undefined;

  private opening!: Promise<mcpTypes.McpClient> | undefined;

  readonly shutdown = new AbortController();

  stderrTail!: string | undefined;

  cwd!: string;

  createTransport!: Options["createTransport"];

  onTools!: Options["onTools"];

  onChange!: Options["onChange"] | undefined;

  log!: Options["log"] | undefined;

  get name(): string {
    return this.entry.name;
  }

  get closed(): boolean {
    return this.shutdown.signal.aborted;
  }

  get timeoutMs(): number {
    return (this.entry.config.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
  }

  signOut(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.opening?.catch(() => undefined));
        if (this.client !== undefined) yield* awaited(this.lifecycle.dropClient(this.client));
        if (!this.closed) this.lifecycle.markNeedsAuth();
      }, this),
    );
  }

  changed(): void {
    this.onChange?.(this);
  }

  close(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
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

        yield* awaited(this.auth.authProvider?.settled());
      }, this),
    );
  }

  getClient(): Promise<mcpTypes.McpClient> {
    if (this.closed)
      return Promise.reject(new Error(`MCP server "${this.entry.name}" is shut down`));
    if (this.client?.connectionState === "connected") return Promise.resolve(this.client);
    this.opening ??= this.lifecycle.open().finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }

  reconnect(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.opening?.catch(() => undefined));
        if (this.client !== undefined) yield* awaited(this.lifecycle.dropClient(this.client));
        yield* awaited(this.getClient());
      }, this),
    );
  }

  callTool(...args: Parameters<McpRequests["callTool"]>): ReturnType<McpRequests["callTool"]> {
    return this.requests.callTool(...args);
  }

  readResource(
    ...args: Parameters<McpRequests["readResource"]>
  ): ReturnType<McpRequests["readResource"]> {
    return this.requests.readResource(...args);
  }

  resourcesPage(
    ...args: Parameters<McpRequests["resourcesPage"]>
  ): ReturnType<McpRequests["resourcesPage"]> {
    return this.requests.resourcesPage(...args);
  }

  resourceTemplatesPage(
    ...args: Parameters<McpRequests["resourceTemplatesPage"]>
  ): ReturnType<McpRequests["resourceTemplatesPage"]> {
    return this.requests.resourceTemplatesPage(...args);
  }

  allResources(
    ...args: Parameters<McpRequests["allResources"]>
  ): ReturnType<McpRequests["allResources"]> {
    return this.requests.allResources(...args);
  }

  allResourceTemplates(
    ...args: Parameters<McpRequests["allResourceTemplates"]>
  ): ReturnType<McpRequests["allResourceTemplates"]> {
    return this.requests.allResourceTemplates(...args);
  }

  constructor(options: Options) {
    this.lifecycle = new McpConnectionLifecycle(this);
    this.requests = new McpRequests(this);
    this.auth = new McpConnectionAuth(this);
    this.entry = options.entry;
    this.cwd = options.cwd;
    this.createTransport = options.createTransport;
    this.onTools = options.onTools;
    this.onChange = options.onChange;
    this.log = options.log;
    this.auth.configure(options.credentials, options.providerToken);
  }
}

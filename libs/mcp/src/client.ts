import { Effect } from "effect";

import { McpClientCore, type McpRequestOptions } from "./client-core.ts";
import {
  isResource,
  isResourceTemplate,
  isTool,
  type ItemCheck,
  listAll,
  listPage,
  type ListSpec,
  pageCursor,
  toResource,
  toResourceTemplate,
  validateCallToolResult,
  validateInitializeResult,
  validateReadResourceResult,
} from "./client-results.ts";
import { fromPromise, fromSync, toPromise } from "./foreign.ts";
import type { CallToolResult } from "./protocol/content.ts";
import { McpClientError } from "./protocol/errors/client-error.ts";
import { McpConnectionClosedError } from "./protocol/jsonrpc.ts";
import {
  type ClientCapabilities,
  type Implementation,
  type InitializeResult,
  LATEST_PROTOCOL_VERSION,
  type ListResourcesResult,
  type ListResourceTemplatesResult,
  type ReadResourceResult,
  type Resource,
  type ResourceTemplate,
  type Root,
  type ServerCapabilities,
  SUPPORTED_PROTOCOL_VERSIONS,
  type SupportedProtocolVersion,
  type Tool,
} from "./protocol/types.ts";
import type { McpTransport } from "./transports/transport.ts";

export type { McpRequestOptions } from "./client-core.ts";

export interface McpClientOptions extends Implementation {
  capabilities?: ClientCapabilities;
  protocolVersion?: SupportedProtocolVersion;
  requestTimeoutMs?: number;
  roots?: readonly Root[] | (() => readonly Root[] | Promise<readonly Root[]>);
}

const TEMPLATES = "resources/templates/list";

export class McpClient extends McpClientCore {
  readonly options: Readonly<McpClientOptions>;
  private serverInfoValue: Implementation | undefined;
  private serverCapabilitiesValue: ServerCapabilities | undefined;
  private instructionsValue: string | undefined;
  private protocolVersionValue: string | undefined;

  constructor(options: McpClientOptions) {
    super(options.requestTimeoutMs);
    this.options = Object.freeze({ ...options });
    this.incoming.setHandler("ping", () => ({}));
    const roots = options.roots;
    if (roots !== undefined) {
      this.incoming.setHandler("roots/list", () =>
        Promise.resolve(typeof roots === "function" ? roots() : roots).then((list) => ({
          roots: [...list],
        })),
      );
    }
  }

  get serverInfo(): Implementation | undefined {
    return this.serverInfoValue;
  }

  get serverCapabilities(): ServerCapabilities | undefined {
    return this.serverCapabilitiesValue;
  }

  get instructions(): string | undefined {
    return this.instructionsValue;
  }

  get protocolVersion(): string | undefined {
    return this.protocolVersionValue;
  }

  connect(transport: McpTransport): Promise<InitializeResult> {
    if (this.state !== "idle")
      return toPromise(
        Effect.fail(new McpClientError(`Cannot connect MCP client in ${this.state} state`)),
      );
    this.state = "connecting";
    this.transport = transport;
    this.disposers = [
      transport.onMessage((message) => this.handleMessage(message)),
      transport.onError((error) => this.emitError(error)),
      transport.onClose(() => this.markClosed(new McpConnectionClosedError())),
    ];
    return toPromise(
      this.initialize(transport).pipe(
        Effect.onError(() => fromPromise(() => this.close()).pipe(Effect.ignore)),
      ),
    );
  }

  ping(options: McpRequestOptions = {}): Promise<void> {
    return toPromise(Effect.asVoid(this.requestEffect("ping", undefined, options, false)));
  }

  listTools(options: McpRequestOptions = {}): Promise<Tool[]> {
    return toPromise(
      listAll(this.spec("tools/list", "tools", isTool, options)).pipe(
        Effect.map((items) => items as unknown as Tool[]),
      ),
    );
  }

  listResources(options: McpRequestOptions = {}): Promise<Resource[]> {
    return toPromise(
      listAll(this.spec("resources/list", "resources", isResource, options)).pipe(
        Effect.map((items) => items.map(toResource)),
      ),
    );
  }

  listResourcesPage(
    cursor?: string,
    options: McpRequestOptions = {},
  ): Promise<ListResourcesResult> {
    const spec = this.spec("resources/list", "resources", isResource, options);
    return toPromise(
      listPage({ ...spec, cursor }).pipe(
        Effect.map((page) => ({ resources: page.items.map(toResource), ...pageCursor(page) })),
      ),
    );
  }

  listResourceTemplates(options: McpRequestOptions = {}): Promise<ResourceTemplate[]> {
    return toPromise(
      listAll(this.spec(TEMPLATES, "resourceTemplates", isResourceTemplate, options)).pipe(
        Effect.map((items) => items.map(toResourceTemplate)),
      ),
    );
  }

  listResourceTemplatesPage(
    cursor?: string,
    options: McpRequestOptions = {},
  ): Promise<ListResourceTemplatesResult> {
    const spec = this.spec(TEMPLATES, "resourceTemplates", isResourceTemplate, options);
    return toPromise(
      listPage({ ...spec, cursor }).pipe(
        Effect.map((page) => ({
          resourceTemplates: page.items.map(toResourceTemplate),
          ...pageCursor(page),
        })),
      ),
    );
  }

  readResource(uri: string, options: McpRequestOptions = {}): Promise<ReadResourceResult> {
    return toPromise(
      this.requestEffect("resources/read", { uri }, options, false).pipe(
        Effect.flatMap((value) => fromSync(() => validateReadResourceResult(value))),
      ),
    );
  }

  callTool(
    name: string,
    args?: Record<string, unknown>,
    options: McpRequestOptions = {},
  ): Promise<CallToolResult> {
    const params = { name, ...(args === undefined ? {} : { arguments: args }) };
    return toPromise(
      this.requestEffect("tools/call", params, options, false).pipe(
        Effect.flatMap((value) => fromSync(() => validateCallToolResult(value))),
      ),
    );
  }

  private spec(
    method: string,
    key: string,
    isItem: ItemCheck,
    options: McpRequestOptions,
  ): ListSpec {
    return {
      method,
      key,
      isItem,
      request: (cursor) =>
        this.requestEffect(method, cursor === undefined ? undefined : { cursor }, options, false),
    };
  }

  private initialize(transport: McpTransport) {
    return Effect.gen({ self: this }, function* () {
      yield* fromPromise(() => transport.start());
      const capabilities: ClientCapabilities = { ...this.options.capabilities };
      if (this.options.roots !== undefined && capabilities.roots === undefined)
        capabilities.roots = {};
      const clientInfo = {
        name: this.options.name,
        version: this.options.version,
        ...(this.options.title === undefined ? {} : { title: this.options.title }),
      };
      const protocolVersion = this.options.protocolVersion ?? LATEST_PROTOCOL_VERSION;
      const params = { protocolVersion, capabilities, clientInfo };
      const value = yield* this.requestEffect("initialize", params, {}, true);
      const result = yield* fromSync(() => validateInitializeResult(value));
      const supported: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS;
      if (!supported.includes(result.protocolVersion)) {
        return yield* new McpClientError(
          `MCP server selected unsupported protocol version ${result.protocolVersion}`,
        );
      }
      this.protocolVersionValue = result.protocolVersion;
      this.serverInfoValue = result.serverInfo;
      this.serverCapabilitiesValue = result.capabilities;
      this.instructionsValue = result.instructions;
      transport.setProtocolVersion?.(result.protocolVersion);
      yield* this.notifyEffect("notifications/initialized", undefined, true);
      this.state = "connected";
      return result;
    });
  }
}

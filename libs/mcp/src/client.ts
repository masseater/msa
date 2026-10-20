import { Effect } from "effect";

import type clientCoreTypes from "./client-core.types.ts";
import clientKit from "./client-kit.ts";
import type clientResultsTypes from "./client-results.types.ts";
import type clientTypes from "./client.types.ts";
import type contentTypes from "./protocol/content.types.ts";
import jsonrpcModule from "./protocol/jsonrpc.ts";
import types from "./protocol/types.ts";
import type typesModule from "./protocol/types.types.ts";
import type transportTypes from "./transports/transport.types.ts";

const { McpClientCore, McpClientError, clientResults, foreign: foreignModule } = clientKit;

const { fromPromise, fromSync, toPromise } = foreignModule;
const { McpConnectionClosedError } = jsonrpcModule;
const {
  isResource,
  isResourceTemplate,
  isTool,
  listAll,
  listPage,
  pageCursor,
  toResource,
  toResourceTemplate,
  validateCallToolResult,
  validateInitializeResult,
  validateReadResourceResult,
} = clientResults;
const { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } = types;

const TEMPLATES = "resources/templates/list";

export default class McpClient extends McpClientCore {
  readonly options: Readonly<clientTypes.McpClientOptions>;
  private serverInfoValue: typesModule.Implementation | undefined;
  private serverCapabilitiesValue: typesModule.ServerCapabilities | undefined;
  private instructionsValue: string | undefined;
  private protocolVersionValue: string | undefined;

  constructor(options: clientTypes.McpClientOptions) {
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

  get serverInfo(): typesModule.Implementation | undefined {
    return this.serverInfoValue;
  }

  get serverCapabilities(): typesModule.ServerCapabilities | undefined {
    return this.serverCapabilitiesValue;
  }

  get instructions(): string | undefined {
    return this.instructionsValue;
  }

  get protocolVersion(): string | undefined {
    return this.protocolVersionValue;
  }

  connect(transport: transportTypes.McpTransport): Promise<typesModule.InitializeResult> {
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

  ping(options: clientCoreTypes.McpRequestOptions = {}): Promise<void> {
    return toPromise(Effect.asVoid(this.requestEffect("ping", undefined, options, false)));
  }

  listTools(options: clientCoreTypes.McpRequestOptions = {}): Promise<typesModule.Tool[]> {
    return toPromise(
      listAll(this.spec("tools/list", "tools", isTool, options)).pipe(
        Effect.map((items) => items as unknown as typesModule.Tool[]),
      ),
    );
  }

  listResources(options: clientCoreTypes.McpRequestOptions = {}): Promise<typesModule.Resource[]> {
    return toPromise(
      listAll(this.spec("resources/list", "resources", isResource, options)).pipe(
        Effect.map((items) => items.map(toResource)),
      ),
    );
  }

  listResourcesPage(
    cursor?: string,
    options: clientCoreTypes.McpRequestOptions = {},
  ): Promise<typesModule.ListResourcesResult> {
    const spec = this.spec("resources/list", "resources", isResource, options);
    return toPromise(
      listPage({ ...spec, cursor }).pipe(
        Effect.map((page) => ({ resources: page.items.map(toResource), ...pageCursor(page) })),
      ),
    );
  }

  listResourceTemplates(
    options: clientCoreTypes.McpRequestOptions = {},
  ): Promise<typesModule.ResourceTemplate[]> {
    return toPromise(
      listAll(this.spec(TEMPLATES, "resourceTemplates", isResourceTemplate, options)).pipe(
        Effect.map((items) => items.map(toResourceTemplate)),
      ),
    );
  }

  listResourceTemplatesPage(
    cursor?: string,
    options: clientCoreTypes.McpRequestOptions = {},
  ): Promise<typesModule.ListResourceTemplatesResult> {
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

  readResource(
    uri: string,
    options: clientCoreTypes.McpRequestOptions = {},
  ): Promise<typesModule.ReadResourceResult> {
    return toPromise(
      this.requestEffect("resources/read", { uri }, options, false).pipe(
        Effect.flatMap((value) => fromSync(() => validateReadResourceResult(value))),
      ),
    );
  }

  callTool(
    name: string,
    args?: Record<string, unknown>,
    options: clientCoreTypes.McpRequestOptions = {},
  ): Promise<contentTypes.CallToolResult> {
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
    isItem: clientResultsTypes.ItemCheck,
    options: clientCoreTypes.McpRequestOptions,
  ): clientResultsTypes.ListSpec {
    return {
      isItem,
      key,
      method,
      request: (cursor) =>
        this.requestEffect(method, cursor === undefined ? undefined : { cursor }, options, false),
    };
  }

  private initialize(transport: transportTypes.McpTransport) {
    return Effect.gen({ self: this }, function* () {
      yield* fromPromise(() => transport.start());
      const capabilities: typesModule.ClientCapabilities = { ...this.options.capabilities };
      if (this.options.roots !== undefined && capabilities.roots === undefined)
        capabilities.roots = {};
      const clientInfo = {
        name: this.options.name,
        version: this.options.version,
        ...(this.options.title === undefined ? {} : { title: this.options.title }),
      };
      const protocolVersion = this.options.protocolVersion ?? LATEST_PROTOCOL_VERSION;
      const params = { capabilities, clientInfo, protocolVersion };
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

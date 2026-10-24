import mcp from "@msa/mcp";
import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import awaitingModule from "../../../core/awaiting.ts";
import mcpServerConnectionHelpers from "../mcp-server-connection-helpers.ts";
import type McpServerConnection from "../mcp-server-connection.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { McpHttpError, McpSessionExpiredError } = mcp;
const {
  signInRequiredMessage,
  CONNECT_RETRY_DELAYS_MS,
  isTransientError,
  listTemplates,
  withoutTemplates,
} = mcpServerConnectionHelpers;

export default class McpRequests {
  private readonly connection: McpServerConnection;

  constructor(connection: McpServerConnection) {
    this.connection = connection;
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

  private withClient<T>(
    run: (client: mcpTypes.McpClient) => Promise<T>,
    readOnly = false,
  ): Promise<T> {
    return Effect.runPromise(
      awaitingWith(function* () {
        for (let attempt = 1; ; attempt++) {
          const client = yield* awaited(this.getClient());
          try {
            return yield* awaited(run(client));
          } catch (error) {
            if (
              readOnly &&
              attempt === 1 &&
              Schema.is(McpHttpError)(error) &&
              isTransientError(error)
            ) {
              yield* performed(Effect.sleep(CONNECT_RETRY_DELAYS_MS[0] ?? 0));
              continue;
            }
            if (Schema.is(McpSessionExpiredError)(error) && attempt === 1) {
              if (this.client === client) this.client = undefined;
              continue;
            }
            if (!this.lifecycle.needsSignIn(error)) throw error;
            yield* awaited(this.lifecycle.dropClient(client));
            this.lifecycle.markNeedsAuth();
            throw new Error(signInRequiredMessage(this.entry), { cause: error });
          }
        }
      }, this.connection),
    );
  }
}

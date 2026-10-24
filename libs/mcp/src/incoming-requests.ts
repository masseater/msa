import { Effect, Schema } from "effect";

import foreignModule from "./foreign.ts";
import type incomingRequestsTypes from "./incoming-requests.types.ts";
import jsonrpcModule from "./protocol/jsonrpc.ts";
import type jsonrpcTypes from "./protocol/jsonrpc.types.ts";
import type transportTypes from "./transports/transport.types.ts";

const { McpForeignError, fromPromise } = foreignModule;
const { JSON_RPC_ERROR_CODES, McpError, toError } = jsonrpcModule;

const responseError = (failure: unknown): jsonrpcTypes.JsonRpcErrorObject => {
  const error = Schema.is(McpForeignError)(failure) ? failure.cause : failure;
  return Schema.is(McpError)(error)
    ? { code: error.code, data: error.data, message: error.message }
    : { code: JSON_RPC_ERROR_CODES.internalError, message: toError(error).message };
};

export default class IncomingRequests {
  private handlers = new Map<string, incomingRequestsTypes.RequestHandler>();
  private controllers = new Map<jsonrpcTypes.JsonRpcId, AbortController>();
  private reportError: (error: unknown) => void;

  constructor(reportError: (error: unknown) => void) {
    this.reportError = reportError;
  }

  setHandler(method: string, handler: incomingRequestsTypes.RequestHandler): () => void {
    this.handlers.set(method, handler);
    return () => {
      if (this.handlers.get(method) === handler) this.handlers.delete(method);
    };
  }

  abort(id: jsonrpcTypes.JsonRpcId, reason: unknown): void {
    this.controllers.get(id)?.abort(reason);
  }

  abortAll(reason: unknown): void {
    for (const controller of this.controllers.values()) controller.abort(reason);
    this.controllers.clear();
  }

  handle(transport: transportTypes.McpTransport, message: jsonrpcTypes.JsonRpcRequest): void {
    Effect.runFork(this.serve(transport, message));
  }

  private serve(
    transport: transportTypes.McpTransport,
    message: jsonrpcTypes.JsonRpcRequest,
  ): Effect.Effect<void> {
    const handler = this.handlers.get(message.method);
    const report = (error: unknown) => Effect.sync(() => this.reportError(error));
    if (handler === undefined) {
      return fromPromise(() =>
        transport.send({
          error: {
            code: JSON_RPC_ERROR_CODES.methodNotFound,
            message: `Method not found: ${message.method}`,
          },
          id: message.id,
          jsonrpc: "2.0",
        }),
      ).pipe(Effect.catch((error) => report(error.cause)));
    }
    const controller = new AbortController();
    this.controllers.set(message.id, controller);
    return fromPromise(() => handler(message.params, { signal: controller.signal })).pipe(
      Effect.flatMap((result) =>
        fromPromise(() => transport.send({ id: message.id, jsonrpc: "2.0", result: result ?? {} })),
      ),
      Effect.catch((failure) =>
        fromPromise(() =>
          transport.send({ error: responseError(failure), id: message.id, jsonrpc: "2.0" }),
        ).pipe(Effect.catch((sendError) => report(sendError.cause))),
      ),
      Effect.ensuring(Effect.sync(() => this.controllers.delete(message.id))),
    );
  }
}

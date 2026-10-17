import { Effect } from "effect";

import { fromPromise, McpForeignError } from "./foreign.ts";
import {
  JSON_RPC_ERROR_CODES,
  type JsonRpcErrorObject,
  type JsonRpcId,
  type JsonRpcRequest,
  McpError,
  toError,
} from "./protocol/jsonrpc.ts";
import type { McpTransport } from "./transports/transport.ts";

export type RequestHandler = (
  params: unknown,
  context: { signal: AbortSignal },
) => unknown | Promise<unknown>;

const responseError = (failure: unknown): JsonRpcErrorObject => {
  const error = failure instanceof McpForeignError ? failure.cause : failure;
  return error instanceof McpError
    ? { code: error.code, message: error.message, data: error.data }
    : { code: JSON_RPC_ERROR_CODES.internalError, message: toError(error).message };
};

export class IncomingRequests {
  private handlers = new Map<string, RequestHandler>();
  private controllers = new Map<JsonRpcId, AbortController>();
  private reportError: (error: unknown) => void;

  constructor(reportError: (error: unknown) => void) {
    this.reportError = reportError;
  }

  setHandler(method: string, handler: RequestHandler): () => void {
    this.handlers.set(method, handler);
    return () => {
      if (this.handlers.get(method) === handler) this.handlers.delete(method);
    };
  }

  abort(id: JsonRpcId, reason: unknown): void {
    this.controllers.get(id)?.abort(reason);
  }

  abortAll(reason: unknown): void {
    for (const controller of this.controllers.values()) controller.abort(reason);
    this.controllers.clear();
  }

  handle(transport: McpTransport, message: JsonRpcRequest): void {
    Effect.runFork(this.serve(transport, message));
  }

  private serve(transport: McpTransport, message: JsonRpcRequest): Effect.Effect<void> {
    const handler = this.handlers.get(message.method);
    const report = (error: unknown) => Effect.sync(() => this.reportError(error));
    if (handler === undefined) {
      return fromPromise(() =>
        transport.send({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: JSON_RPC_ERROR_CODES.methodNotFound,
            message: `Method not found: ${message.method}`,
          },
        }),
      ).pipe(Effect.catch((error) => report(error.cause)));
    }
    const controller = new AbortController();
    this.controllers.set(message.id, controller);
    return fromPromise(() => handler(message.params, { signal: controller.signal })).pipe(
      Effect.flatMap((result) =>
        fromPromise(() => transport.send({ jsonrpc: "2.0", id: message.id, result: result ?? {} })),
      ),
      Effect.catch((failure) =>
        fromPromise(() =>
          transport.send({ jsonrpc: "2.0", id: message.id, error: responseError(failure) }),
        ).pipe(Effect.catch((sendError) => report(sendError.cause))),
      ),
      Effect.ensuring(Effect.sync(() => this.controllers.delete(message.id))),
    );
  }
}

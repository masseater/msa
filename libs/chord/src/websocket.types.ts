import type compressionTypes from "./compression.types.ts";
import type connectionTypes from "./connection.types.ts";
import type linkTypes from "./link.types.ts";

declare namespace websocketTypes {
  interface WebSocketServerLike<Request> {
    on(
      event: "connection",
      listener: (socket: linkTypes.WebSocketLike, request: Request) => void,
    ): unknown;
  }

  interface WebSocketAcceptOptions<Request, P = unknown>
    extends
      Omit<connectionTypes.AcceptOptions<P>, "principal" | "kind" | "name">,
      compressionTypes.CompressionOptions {
    principal(request: Request): P | undefined | Promise<P | undefined>;
  }
}

export type { websocketTypes as default };

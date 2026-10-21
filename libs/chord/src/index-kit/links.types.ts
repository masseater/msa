import type connectionTypesModule from "../connection-types.types.ts";
import type linkBaseTypes from "../link-base.types.ts";
import type linkIpcTypes from "../link-ipc.types.ts";
import type linkWebsocketTypes from "../link-websocket.types.ts";
import type websocketTypes from "../websocket.types.ts";
import type wireTypes from "../wire.types.ts";

declare namespace chordLinksKitTypes {
  type AcceptOptions<P = unknown> = connectionTypesModule.AcceptOptions<P>;

  type LinkOptions = connectionTypesModule.LinkOptions;

  type IpcChannel = linkIpcTypes.IpcChannel;

  type Link = linkBaseTypes.Link;

  type WebSocketLike = linkWebsocketTypes.WebSocketLike;

  type WebSocketLinkOptions = linkWebsocketTypes.WebSocketLinkOptions;

  type WebSocketAcceptOptions<Request, P = unknown> = websocketTypes.WebSocketAcceptOptions<
    Request,
    P
  >;

  type WebSocketServerLike<Request> = websocketTypes.WebSocketServerLike<Request>;

  type Frame = wireTypes.Frame;
}

export type { chordLinksKitTypes as default };

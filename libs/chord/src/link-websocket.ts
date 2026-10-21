import { dual } from "effect/Function";

import type linkWebsocketTypes from "./link-websocket.types.ts";
import WebSocketLink from "./web-socket-link.ts";

const webSocketLink: {
  (
    options?: linkWebsocketTypes.WebSocketLinkOptions,
  ): (socket: linkWebsocketTypes.WebSocketLike) => WebSocketLink;
  (
    socket: linkWebsocketTypes.WebSocketLike,
    options?: linkWebsocketTypes.WebSocketLinkOptions,
  ): WebSocketLink;
} = dual(
  (args) => args.length >= 1,
  (
    socket: linkWebsocketTypes.WebSocketLike,
    options?: linkWebsocketTypes.WebSocketLinkOptions,
  ): WebSocketLink => new WebSocketLink(socket, options),
);

const linkWebsocket = {
  WebSocketLink,
  webSocketLink,
};

export default linkWebsocket;

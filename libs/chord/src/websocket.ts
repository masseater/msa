import { dual } from "effect/Function";

import type hostTypesModule from "./host-types.types.ts";
import linkModule from "./link.ts";
import type websocketTypes from "./websocket.types.ts";

const { webSocketLink } = linkModule;

function webSocketsAccepted<Request, P = unknown>(
  server: websocketTypes.WebSocketServerLike<Request>,
  host: hostTypesModule.Host<P>,
  options: websocketTypes.WebSocketAcceptOptions<Request, P>,
): void {
  const { compression, ...accept } = options;
  server.on("connection", (socket, request) => {
    const link = webSocketLink(socket, { acceptPacked: false, compress: true, compression });
    Promise.resolve(accept.principal(request)).then(
      (principal) => {
        if (principal === undefined) link.close("unauthorized");
        else host.accept(link, { ...accept, kind: "client", principal });
        return undefined;
      },
      () => link.close("authentication failed"),
    );
  });
}

const acceptWebSockets: {
  <Request, P = unknown>(
    host: hostTypesModule.Host<P>,
    options: websocketTypes.WebSocketAcceptOptions<Request, P>,
  ): (server: websocketTypes.WebSocketServerLike<Request>) => void;
  <Request, P = unknown>(
    server: websocketTypes.WebSocketServerLike<Request>,
    host: hostTypesModule.Host<P>,
    options: websocketTypes.WebSocketAcceptOptions<Request, P>,
  ): void;
} = dual(3, webSocketsAccepted);

const websocket = {
  acceptWebSockets,
};

export default websocket;

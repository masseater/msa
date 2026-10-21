import type compressionTypes from "./compression.types.ts";
import type linkWebsocket from "./link-websocket.ts";

declare namespace linkWebsocketTypes {
  interface WebSocketLike {
    readonly readyState: number;
    send(data: string | Uint8Array): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
    addEventListener(type: "open" | "close" | "error", listener: () => void): void;
  }

  interface WebSocketLinkOptions extends compressionTypes.CompressionOptions {
    readonly compress?: boolean;
    readonly acceptPacked?: boolean;
  }

  type WebSocketLink = (typeof linkWebsocket.WebSocketLink)["prototype"];
}

export type { linkWebsocketTypes as default };

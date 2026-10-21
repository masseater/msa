declare namespace openaiCodexWsConstructorTypes {
  type WebSocketEventType = "open" | "message" | "error" | "close";

  type WebSocketListener = (event: unknown) => void;

  interface WebSocketLike {
    close(code?: number, reason?: string): void;
    send(data: string): void;
    addEventListener(type: WebSocketEventType, listener: WebSocketListener): void;
    removeEventListener(type: WebSocketEventType, listener: WebSocketListener): void;
  }

  type WebSocketConstructor = new (
    url: string,
    protocols?: string | string[] | { headers?: Record<string, string> },
  ) => WebSocketLike;
}

export type { openaiCodexWsConstructorTypes as default };

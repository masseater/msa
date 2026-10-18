import type { ProviderEnv } from "../types.ts";
import { resolveHttpProxyUrlForTarget } from "../utils/node-http-proxy.ts";

export type WebSocketEventType = "open" | "message" | "error" | "close";
export type WebSocketListener = (event: unknown) => void;

export interface WebSocketLike {
  close(code?: number, reason?: string): void;
  send(data: string): void;
  addEventListener(type: WebSocketEventType, listener: WebSocketListener): void;
  removeEventListener(type: WebSocketEventType, listener: WebSocketListener): void;
}

export type WebSocketConstructor = new (
  url: string,
  protocols?: string | string[] | { headers?: Record<string, string> },
) => WebSocketLike;

type WebSocketInit = Exclude<
  ConstructorParameters<typeof WebSocket>[1],
  string | string[] | undefined
>;

const isBun = (): boolean =>
  typeof process !== "undefined" &&
  process.versions?.["bun"] !== undefined &&
  process.versions["bun"] !== "";

function proxiedWebSocket(env: ProviderEnv | undefined): WebSocketConstructor {
  return class extends WebSocket {
    constructor(url: string | URL, options?: string | string[] | WebSocketInit) {
      const socketOptions: WebSocketInit =
        Array.isArray(options) || typeof options === "string"
          ? { protocols: options }
          : { ...options };
      const proxyUrl = resolveHttpProxyUrlForTarget(
        url.toString().replace(/^wss:/u, "https:").replace(/^ws:/u, "http:"),
        env,
      );
      const init: WebSocketInit & { proxy?: string } = {
        ...socketOptions,
        ...(proxyUrl === undefined ? {} : { proxy: proxyUrl.toString() }),
      };
      super(url, init);
    }
  };
}

let cachedWebsocket: WebSocketConstructor | null = null;

export function getWebSocketConstructor(env?: ProviderEnv): WebSocketConstructor | null {
  if (env === undefined && cachedWebsocket !== null) return cachedWebsocket;
  if (isBun()) {
    const ctor = proxiedWebSocket(env);
    if (env === undefined) cachedWebsocket = ctor;
    return ctor;
  }
  const ctor = (globalThis as { WebSocket?: unknown }).WebSocket;
  return typeof ctor === "function" ? (ctor as WebSocketConstructor) : null;
}

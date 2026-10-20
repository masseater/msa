import type typesModule from "../types.types.ts";
import nodeHttpProxy from "../utils/node-http-proxy.ts";
import type openaiCodexWsConstructorTypes from "./openai-codex-ws-constructor.types.ts";

const { resolveHttpProxyUrlForTarget } = nodeHttpProxy;

type WebSocketInit = Exclude<
  ConstructorParameters<typeof WebSocket>[1],
  string | string[] | undefined
>;

const isBun = (): boolean =>
  typeof process !== "undefined" &&
  process.versions?.["bun"] !== undefined &&
  process.versions["bun"] !== "";

function proxiedWebSocket(
  env: typesModule.ProviderEnv | undefined,
): openaiCodexWsConstructorTypes.WebSocketConstructor {
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

let cachedWebsocket: openaiCodexWsConstructorTypes.WebSocketConstructor | null = null;

function getWebSocketConstructor(
  env?: typesModule.ProviderEnv,
): openaiCodexWsConstructorTypes.WebSocketConstructor | null {
  if (env === undefined && cachedWebsocket !== null) return cachedWebsocket;
  if (isBun()) {
    const ctor = proxiedWebSocket(env);
    if (env === undefined) cachedWebsocket = ctor;
    return ctor;
  }
  const ctor = (globalThis as { WebSocket?: unknown }).WebSocket;
  return typeof ctor === "function"
    ? (ctor as openaiCodexWsConstructorTypes.WebSocketConstructor)
    : null;
}

const openaiCodexWsConstructor = {
  getWebSocketConstructor,
};

export default openaiCodexWsConstructor;

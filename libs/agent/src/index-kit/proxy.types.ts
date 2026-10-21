import type proxyEventsTypes from "../proxy-events.types.ts";
import type proxyTypes from "../proxy.types.ts";

declare namespace agentProxyKitTypes {
  type ProxyAssistantMessageEvent = proxyEventsTypes.ProxyAssistantMessageEvent;
  type ProxyStreamOptions = proxyTypes.ProxyStreamOptions;
}

export type { agentProxyKitTypes as default };

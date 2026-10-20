import type InboundClass from "./connection-inbound.ts";

declare namespace connectionInboundTypes {
  type Inbound = InboundClass;
}

export type { connectionInboundTypes as default };

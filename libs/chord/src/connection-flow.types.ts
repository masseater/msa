import type ConnectionFlowClass from "./connection-flow.ts";
import type linkTypes from "./link.types.ts";
import type timersTypes from "./timers.types.ts";

declare namespace connectionFlowTypes {
  interface FlowOwner {
    readonly link: linkTypes.Link;
    readonly open: boolean;
    readonly timers: timersTypes.HostTimers;
    violation(reason: string): void;
  }

  type ConnectionFlow = ConnectionFlowClass;
}

export type { connectionFlowTypes as default };

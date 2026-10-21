import type HostTimersClass from "./timers.ts";

declare namespace timersTypes {
  type HostTimers = HostTimersClass;
}

export type { timersTypes as default };

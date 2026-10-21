import type TrackerImplClass from "./tracker-impl.ts";

declare namespace trackerImplTypes {
  type TrackerImpl<T extends object> = TrackerImplClass<T>;
}

export type { trackerImplTypes as default };

import type SchedulerIndexClass from "./scheduler-index.ts";

declare namespace schedulerIndexTypes {
  type IndexHooks = {
    readonly scheduleReconcile: () => void;
    readonly scheduleSweep: () => void;
  };

  type IndexSizes = Readonly<
    Record<"live" | "settled" | "edges" | "below" | "roots" | "unloaded" | "dropQueue", number>
  >;

  type SchedulerIndex = SchedulerIndexClass;
}

export type { schedulerIndexTypes as default };

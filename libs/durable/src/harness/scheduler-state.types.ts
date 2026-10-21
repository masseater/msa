import type contextTypes from "./context.types.ts";
import type schedulerGraphTypes from "./scheduler-graph.types.ts";
import type SchedulerStateClass from "./scheduler-state.ts";

declare namespace schedulerStateTypes {
  type Wake = {
    readonly reconcile: () => void;
    readonly kick: () => void;
  };

  type KeptContext = { range: contextTypes.ContextRange; idleSince: number | undefined };

  type SchedulerState = SchedulerStateClass;

  type SchedulerGraph = schedulerGraphTypes.SchedulerGraph;
}

export type { schedulerStateTypes as default };

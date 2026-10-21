import type contextTypes from "./context.types.ts";
import type schedulerStateTypes from "./scheduler-state.types.ts";
import type schedulerTypesModule from "./scheduler-types.types.ts";

declare namespace schedulerRuntimeReadsTypes {
  type RuntimeParts = {
    readonly state: schedulerStateTypes.SchedulerState;
    readonly invocation: schedulerTypesModule.Invocation;
  };

  type ContextRange = contextTypes.ContextRange;

  type SchedulerState = schedulerStateTypes.SchedulerState;
}

export type { schedulerRuntimeReadsTypes as default };

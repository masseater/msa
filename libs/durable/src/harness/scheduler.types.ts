import type schedulerTypesModule from "./scheduler-types.types.ts";
import type TaskSchedulerClass from "./scheduler.ts";

declare namespace schedulerTypes {
  type InvocationBinding = schedulerTypesModule.InvocationBinding;

  type SchedulerOutcome = schedulerTypesModule.SchedulerOutcome;

  type TaskSchedulerOptions = schedulerTypesModule.TaskSchedulerOptions;

  type TaskScheduler = TaskSchedulerClass;
}

export type { schedulerTypes as default };

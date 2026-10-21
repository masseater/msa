import type orchestratorTypesTypes from "./types.types.ts";

declare namespace watchdogTypes {
  interface Finding {
    thread: orchestratorTypesTypes.Thread;
    threadStatus: orchestratorTypesTypes.ThreadStatus;
    taskStatus: orchestratorTypesTypes.TaskStatus;
    reason: string;
  }
}

export type { watchdogTypes as default };

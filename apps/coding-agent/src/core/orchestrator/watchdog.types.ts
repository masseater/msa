import type orchestratorTypesTypes from "./types.types.ts";

declare namespace watchdogTypes {
  interface Finding {
    thread: orchestratorTypesTypes.Thread;
    threadStatus: orchestratorTypesTypes.ThreadStatus;
    taskStatus: orchestratorTypesTypes.TaskStatus;
    reason: string;
  }

  interface RecoveryNotice {
    taskId: string;
    title: string;
    cause: string;
    lastUpdate: number;
    recoveredAt: number;
  }
}

export type { watchdogTypes as default };

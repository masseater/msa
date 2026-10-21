import type orchestratorTypesTypes from "./types.types.ts";

const TASK_STATUSES: readonly orchestratorTypesTypes.TaskStatus[] = [
  "waiting",
  "running",
  "completed",
  "failed",
  "stopped",
];

const THREAD_ROLES: readonly orchestratorTypesTypes.ThreadRole[] = ["worker", "reviewer"];

const orchestratorTypes = {
  TASK_STATUSES,
  THREAD_ROLES,
};

export default orchestratorTypes;

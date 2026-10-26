import type orchestratorTypesTypes from "./types.types.ts";

const TASK_STATUSES: readonly orchestratorTypesTypes.TaskStatus[] = [
  "waiting",
  "running",
  "needs-decision",
  "completed",
  "failed",
  "stopped",
  "closed",
];

const THREAD_ROLES: readonly orchestratorTypesTypes.ThreadRole[] = [
  "worker",
  "reviewer",
  "advisor",
  "triage",
];

const orchestratorTypes = {
  TASK_STATUSES,
  THREAD_ROLES,
};

export default orchestratorTypes;

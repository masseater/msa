import type agentTypes from "@msa/agent-core/index.types";

export type TaskStatus = "waiting" | "running" | "completed" | "failed" | "stopped";
export type TaskKind = "work" | "review";
export type ThreadRole = "worker" | "reviewer";
export type ThreadStatus = "running" | "completed" | "failed" | "stopped";
export type NoteAudience = "all" | "round" | "tasks";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "waiting",
  "running",
  "completed",
  "failed",
  "stopped",
];

export const THREAD_ROLES: readonly ThreadRole[] = ["worker", "reviewer"];

export interface Task {
  id: string;
  project: string;
  round: string;
  kind: TaskKind;
  title: string;
  currentState: string;
  goalState: string;
  status: TaskStatus;
  cwd: string;
  condition: string | null;
  model: string | null;
  thinkingLevel: agentTypes.ThinkingLevel | null;
  createdAt: number;
  updatedAt: number;
}

export interface Thread {
  id: string;
  project: string;
  model: string;
  thinkingLevel: agentTypes.ThinkingLevel;
  cwd: string;
  status: ThreadStatus;
  sessionFile: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Assignment {
  taskId: string;
  threadId: string;
  role: ThreadRole;
  createdAt: number;
}

export interface Report {
  id: string;
  taskId: string;
  threadId: string;
  role: ThreadRole;
  status: ThreadStatus;
  content: string;
  createdAt: number;
}

export interface Note {
  id: string;
  project: string;
  round: string | null;
  taskIds: readonly string[];
  content: string;
  author: string;
  createdAt: number;
}

export interface TaskView extends Task {
  dependsOn: readonly string[];
  dependents: readonly string[];
  assignments: readonly Assignment[];
  reports: readonly Report[];
}

export interface ThreadView extends Thread {
  tasks: readonly { taskId: string; role: ThreadRole }[];
}

export interface RoundView {
  id: string;
  title: string;
  reviewTaskId: string | null;
  taskIds: readonly string[];
}

export type WaitingKind = "dependencies" | "condition" | "capacity" | "scheduling" | "review";

export interface WaitingReason {
  kind: WaitingKind;
  detail: string;
}

export interface TaskSnapshot extends TaskView {
  waitingReason: WaitingReason | null;
  handoff: string | null;
  replan: ReplanMark | null;
}

export interface OrchestratorSnapshot {
  tasks: readonly TaskSnapshot[];
  threads: readonly ThreadView[];
  rounds: readonly RoundView[];
  replans: readonly ReplanView[];
  maxConcurrentThreads: number;
}

export interface ReportHit {
  report: Report;
  taskTitle: string;
  threadModel: string;
}

export interface CreateTaskInput {
  title: string;
  currentState: string;
  goalState: string;
  dependsOn?: readonly string[];
  round?: string;
  condition?: string;
  model?: string;
  thinkingLevel?: agentTypes.ThinkingLevel;
  cwd?: string;
}

export interface SetTaskDependsInput {
  taskIds: readonly string[];
  add?: readonly string[];
  remove?: readonly string[];
}

export interface SetTaskStateInput {
  taskId: string;
  currentState?: string;
  goalState?: string;
}

export interface SendNoteInput {
  content: string;
  audience: NoteAudience;
  round?: string;
  taskIds?: readonly string[];
}

export interface NoteDelivery {
  noteId: string;
  steeredThreads: readonly string[];
  waitingTasks: readonly string[];
}

export interface ReplanTaskInput {
  key?: string;
  from?: readonly string[];
  title: string;
  currentState?: string;
  goalState?: string;
  dependsOn?: readonly string[];
  round?: string;
  model?: string;
  thinkingLevel?: agentTypes.ThinkingLevel;
  cwd?: string;
}

export interface ReplanDropInput {
  taskId: string;
  reason: string;
}

export interface ReplanRewireInput {
  taskId: string;
  dependsOn: readonly string[];
}

export interface ReplanInput {
  reason: string;
  tasks?: readonly ReplanTaskInput[];
  keep?: readonly string[];
  drop?: readonly ReplanDropInput[];
  rewire?: readonly ReplanRewireInput[];
  maxConcurrentThreads?: number;
  stop?: boolean;
  resume?: boolean;
}

export interface ReplanStopped {
  taskId: string;
  title: string;
  threadId: string;
  memo: string;
}

export interface ReplanCreated {
  taskId: string;
  title: string;
  from: readonly string[];
}

export interface ReplanDropped {
  taskId: string;
  title: string;
  reason: string;
}

export interface ReplanRewired {
  taskId: string;
  dependsOn: readonly string[];
}

export interface ReplanResult {
  replanId: string | null;
  aborted: string | null;
  stopped: readonly ReplanStopped[];
  created: readonly ReplanCreated[];
  dropped: readonly ReplanDropped[];
  kept: readonly string[];
  rewired: readonly ReplanRewired[];
  started: readonly string[];
}

export type ReplanRole = "stopped" | "created" | "dropped" | "kept";

export interface ReplanMark {
  id: string;
  reason: string;
  role: ReplanRole;
}

export interface ReplanChanges {
  stopped: readonly ReplanStopped[];
  created: readonly ReplanCreated[];
  dropped: readonly ReplanDropped[];
  kept: readonly string[];
  rewired: readonly ReplanRewired[];
}

export interface ReplanRecord {
  id: string;
  project: string;
  reason: string;
  after: ReplanChanges;
  createdAt: number;
}

export interface ReplanView {
  id: string;
  reason: string;
  createdAt: number;
  stopped: readonly ReplanStopped[];
  created: readonly ReplanCreated[];
  dropped: readonly ReplanDropped[];
  kept: readonly string[];
  rewired: readonly ReplanRewired[];
}

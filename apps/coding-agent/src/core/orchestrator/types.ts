import type { ThinkingLevel } from "@msa/agent-core";

export type TaskStatus = "waiting" | "running" | "completed" | "failed" | "stopped";
export type TaskKind = "work" | "review";
export type SessionRole = "worker" | "reviewer";
export type SessionStatus = "running" | "completed" | "failed" | "stopped";
export type NoteAudience = "all" | "round" | "tasks";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "waiting",
  "running",
  "completed",
  "failed",
  "stopped",
];

export const SESSION_ROLES: readonly SessionRole[] = ["worker", "reviewer"];

export interface Task {
  id: string;
  project: string;
  round: string;
  kind: TaskKind;
  title: string;
  prompt: string;
  status: TaskStatus;
  priority: number;
  cwd: string;
  paths: readonly string[];
  repos: readonly string[];
  condition: string | null;
  model: string | null;
  thinkingLevel: ThinkingLevel | null;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  project: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  cwd: string;
  status: SessionStatus;
  sessionFile: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Assignment {
  taskId: string;
  sessionId: string;
  role: SessionRole;
  createdAt: number;
}

export interface Report {
  id: string;
  taskId: string;
  sessionId: string;
  role: SessionRole;
  status: SessionStatus;
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

export interface SessionView extends Session {
  tasks: readonly { taskId: string; role: SessionRole }[];
}

export interface RoundView {
  id: string;
  title: string;
  reviewTaskId: string | null;
  taskIds: readonly string[];
}

export type WaitingKind =
  | "dependencies"
  | "condition"
  | "capacity"
  | "paths"
  | "scheduling"
  | "review";

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
  sessions: readonly SessionView[];
  rounds: readonly RoundView[];
  replans: readonly ReplanView[];
  maxConcurrentSessions: number;
}

export interface ReportHit {
  report: Report;
  taskTitle: string;
  sessionModel: string;
}

export interface CreateTaskInput {
  title: string;
  prompt: string;
  dependsOn?: readonly string[];
  round?: string;
  paths?: readonly string[];
  repos?: readonly string[];
  condition?: string;
  priority?: number;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  cwd?: string;
}

export interface SetTaskDependsInput {
  taskIds: readonly string[];
  add?: readonly string[];
  remove?: readonly string[];
}

export interface SetTaskInstructionInput {
  taskId: string;
  prompt: string;
}

export interface SendNoteInput {
  content: string;
  audience: NoteAudience;
  round?: string;
  taskIds?: readonly string[];
}

export interface NoteDelivery {
  noteId: string;
  steeredSessions: readonly string[];
  waitingTasks: readonly string[];
}

export interface ReplanTaskInput {
  key?: string;
  from?: readonly string[];
  title: string;
  prompt?: string;
  dependsOn?: readonly string[];
  round?: string;
  paths?: readonly string[];
  repos?: readonly string[];
  priority?: number;
  model?: string;
  thinkingLevel?: ThinkingLevel;
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
  maxConcurrentSessions?: number;
  stop?: boolean;
  resume?: boolean;
}

export interface ReplanStopped {
  taskId: string;
  title: string;
  sessionId: string;
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

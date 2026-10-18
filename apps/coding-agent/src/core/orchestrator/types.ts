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
}

export interface OrchestratorSnapshot {
  tasks: readonly TaskSnapshot[];
  sessions: readonly SessionView[];
  rounds: readonly RoundView[];
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

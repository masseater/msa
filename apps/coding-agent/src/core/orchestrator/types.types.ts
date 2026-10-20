import type agentTypes from "@msa/agent-core/index.types";

declare namespace orchestratorTypesTypes {
  type TaskStatus = "waiting" | "running" | "completed" | "failed" | "stopped";

  type TaskKind = "work" | "review";

  type ThreadRole = "worker" | "reviewer";

  type ThreadStatus = "running" | "completed" | "failed" | "stopped";

  type NoteAudience = "all" | "round" | "tasks";

  interface Task {
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

  interface Thread {
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

  interface Assignment {
    taskId: string;
    threadId: string;
    role: ThreadRole;
    createdAt: number;
  }

  interface Report {
    id: string;
    taskId: string;
    threadId: string;
    role: ThreadRole;
    status: ThreadStatus;
    content: string;
    createdAt: number;
  }

  interface Note {
    id: string;
    project: string;
    round: string | null;
    taskIds: readonly string[];
    content: string;
    author: string;
    createdAt: number;
  }

  interface TaskView extends Task {
    dependsOn: readonly string[];
    dependents: readonly string[];
    assignments: readonly Assignment[];
    reports: readonly Report[];
  }

  interface ThreadView extends Thread {
    tasks: readonly { taskId: string; role: ThreadRole }[];
  }

  interface RoundView {
    id: string;
    title: string;
    reviewTaskId: string | null;
    taskIds: readonly string[];
  }

  type WaitingKind = "dependencies" | "condition" | "capacity" | "scheduling" | "review";

  interface WaitingReason {
    kind: WaitingKind;
    detail: string;
  }

  interface TaskSnapshot extends TaskView {
    waitingReason: WaitingReason | null;
    handoff: string | null;
    replan: ReplanMark | null;
  }

  interface OrchestratorSnapshot {
    tasks: readonly TaskSnapshot[];
    threads: readonly ThreadView[];
    rounds: readonly RoundView[];
    replans: readonly ReplanView[];
    maxConcurrentThreads: number;
  }

  interface ReportHit {
    report: Report;
    taskTitle: string;
    threadModel: string;
  }

  interface CreateTaskInput {
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

  interface SetTaskDependsInput {
    taskIds: readonly string[];
    add?: readonly string[];
    remove?: readonly string[];
  }

  interface SetTaskStateInput {
    taskId: string;
    currentState?: string;
    goalState?: string;
  }

  interface SendNoteInput {
    content: string;
    audience: NoteAudience;
    round?: string;
    taskIds?: readonly string[];
  }

  interface NoteDelivery {
    noteId: string;
    steeredThreads: readonly string[];
    waitingTasks: readonly string[];
  }

  interface ReplanTaskInput {
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

  interface ReplanDropInput {
    taskId: string;
    reason: string;
  }

  interface ReplanRewireInput {
    taskId: string;
    dependsOn: readonly string[];
  }

  interface ReplanInput {
    reason: string;
    tasks?: readonly ReplanTaskInput[];
    keep?: readonly string[];
    drop?: readonly ReplanDropInput[];
    rewire?: readonly ReplanRewireInput[];
    maxConcurrentThreads?: number;
    stop?: boolean;
    resume?: boolean;
  }

  interface ReplanStopped {
    taskId: string;
    title: string;
    threadId: string;
    memo: string;
  }

  interface ReplanCreated {
    taskId: string;
    title: string;
    from: readonly string[];
  }

  interface ReplanDropped {
    taskId: string;
    title: string;
    reason: string;
  }

  interface ReplanRewired {
    taskId: string;
    dependsOn: readonly string[];
  }

  interface ReplanResult {
    replanId: string | null;
    aborted: string | null;
    stopped: readonly ReplanStopped[];
    created: readonly ReplanCreated[];
    dropped: readonly ReplanDropped[];
    kept: readonly string[];
    rewired: readonly ReplanRewired[];
    started: readonly string[];
  }

  type ReplanRole = "stopped" | "created" | "dropped" | "kept";

  interface ReplanMark {
    id: string;
    reason: string;
    role: ReplanRole;
  }

  interface ReplanChanges {
    stopped: readonly ReplanStopped[];
    created: readonly ReplanCreated[];
    dropped: readonly ReplanDropped[];
    kept: readonly string[];
    rewired: readonly ReplanRewired[];
  }

  interface ReplanRecord {
    id: string;
    project: string;
    reason: string;
    after: ReplanChanges;
    createdAt: number;
  }

  interface ReplanView {
    id: string;
    reason: string;
    createdAt: number;
    stopped: readonly ReplanStopped[];
    created: readonly ReplanCreated[];
    dropped: readonly ReplanDropped[];
    kept: readonly string[];
    rewired: readonly ReplanRewired[];
  }
}

export type { orchestratorTypesTypes as default };

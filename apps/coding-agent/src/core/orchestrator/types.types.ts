import type agentTypes from "@msa/agent-core/index.types";

declare namespace orchestratorTypesTypes {
  type TaskStatus =
    | "waiting"
    | "running"
    | "needs-decision"
    | "completed"
    | "failed"
    | "stopped"
    | "closed";

  type TaskKind = "work" | "review";

  type ThreadRole = "worker" | "reviewer" | "advisor" | "triage";

  type ThreadStatus = "running" | "completed" | "failed" | "stopped";

  type ReviewVerdictResult = "pass" | "fail" | "undecided";

  type NoteAudience = "all" | "round" | "tasks";

  interface TaskCheck {
    command: string;
    exitCode: number;
    output: string | null;
  }

  interface TaskCheckInput {
    command: string;
    exitCode?: number;
    output?: string;
  }

  interface Task {
    id: string;
    project: string;
    round: string;
    kind: TaskKind;
    title: string;
    currentState: string;
    goalState: string;
    checks: readonly TaskCheck[];
    status: TaskStatus;
    cwd: string;
    mergeInto: string | null;
    opensPullRequest: boolean;
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
    branch: string | null;
    targetBranch: string | null;
    status: ThreadStatus;
    sessionFile: string | null;
    createdAt: number;
    updatedAt: number;
  }

  interface WorkspaceSource {
    task: Task;
    branch: string;
  }

  interface Workspace {
    cwd: string;
    branch: string | null;
    targetBranch: string | null;
    target: Task | null;
    sources: readonly WorkspaceSource[];
    opensPullRequest?: boolean;
    work?: string;
    history?: string;
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
    verdict: ReviewVerdictResult | null;
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

  type PullRequestCi = "passing" | "pending" | "failing" | "cancelled" | "none";

  interface VerifiedPullRequest {
    sha: string;
    title: string;
    body: string;
  }

  type MergeAttempt =
    | { kind: "merged"; commit: string }
    | { kind: "refused"; why: string }
    | { kind: "unanswered"; why: string };

  interface PullRequest {
    taskId: string;
    number: number;
    url: string;
    branch: string;
    base: string;
    state: string;
    headSha: string;
    ci: PullRequestCi;
    mergeable: string;
    mergeState: string;
    verified: VerifiedPullRequest | null;
    mergeCommit: string | null;
    harnessMerge: string | null;
    harnessNonce: string | null;
    blockedHead: string | null;
    harnessCommit: string | null;
    checkedAt: number;
  }

  interface PullRequestHandover {
    number: number;
    from: string;
    to: string;
  }

  interface OrphanedPullRequest {
    number: number;
    url: string;
    taskId: string;
    branch: string;
  }

  interface UnreadPullRequest {
    taskId: string;
    branch: string;
    error: string;
  }

  interface UntrackedTask {
    taskId: string;
    cwd: string;
  }

  interface TaskView extends Task {
    dependsOn: readonly string[];
    dependents: readonly string[];
    assignments: readonly Assignment[];
    reports: readonly Report[];
    pullRequest: PullRequest | null;
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

  type WaitingKind =
    | "dependencies"
    | "condition"
    | "provider"
    | "capacity"
    | "scheduling"
    | "review";

  interface ProviderWait {
    taskId: string;
    project: string;
    threadId: string;
    role: ThreadRole;
    sessionFile: string | null;
    reason: "auth" | "quota";
    error: string;
    resumeAt: number;
    createdAt: number;
  }

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
    checks?: readonly TaskCheckInput[];
    dependsOn?: readonly string[];
    round?: string;
    condition?: string;
    model?: string;
    thinkingLevel?: agentTypes.ThinkingLevel;
    cwd?: string;
    mergeInto?: string;
    opensPullRequest?: boolean;
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
    checks?: readonly TaskCheckInput[];
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
    checks?: readonly TaskCheckInput[];
    dependsOn?: readonly string[];
    round?: string;
    model?: string;
    thinkingLevel?: agentTypes.ThinkingLevel;
    cwd?: string;
    mergeInto?: string;
    opensPullRequest?: boolean;
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
    handedOver: readonly PullRequestHandover[];
    orphaned: readonly OrphanedPullRequest[];
    untracked: readonly UntrackedTask[];
    unread: readonly UnreadPullRequest[];
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

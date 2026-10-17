import type { Models } from "@msa/ai";
import type { Context, JsonValue } from "@msa/chord";

import type { ExecutionEnv } from "../env/index.ts";
import type { SessionImpl } from "../session/session.ts";
import type { Transaction } from "../session/transaction.ts";
import type {
  Agent,
  AnyTask,
  ConversationHandle,
  ConversationId,
  DocumentWatch,
  JsonObject,
  RegistryReader,
  RegistrySnapshot,
  RunningTask,
  Settings,
  Storage,
  TaskDefinition,
  TaskId,
  TaskOutcome,
  TaskRecord,
  TaskRuntime,
} from "./types.ts";

export type * from "./types.ts";
export type { Transaction } from "../session/transaction.ts";

export type AnyTaskRecord = TaskRecord<JsonValue, JsonValue, JsonValue>;
export type RunnableTaskRecord = Extract<
  AnyTaskRecord,
  { readonly state: { readonly status: "pending" | "running" | "waiting" } }
>;
export type Checkpoint = { readonly phase: string };
export type ErasedDefinition = TaskDefinition<JsonValue, Checkpoint, JsonValue, object>;
export type ErasedRuntime = TaskRuntime<JsonValue, Checkpoint, JsonValue, object>;
export type ErasedRunningTask = RunningTask<JsonValue, Checkpoint, JsonValue>;

export const SCAN_PAGE_SIZE = 256;
export const MAX_TIMER_DELAY = 2_147_483_647;
export const LIVE_STATUSES = ["pending", "running", "waiting", "completing"] as const;

export type BlockedReason = "missing_task" | "task_too_old" | "migration_failed";

export type Resolution =
  | { readonly kind: "ready"; readonly task: AnyTask; readonly record: RunnableTaskRecord }
  | { readonly kind: "blocked"; readonly reason: BlockedReason };

export type Fit =
  | { readonly task: AnyTask; readonly migrates: boolean }
  | { readonly reason: BlockedReason; readonly error?: unknown };

export type Invocation = {
  readonly taskId: TaskId;
  readonly conversationId: ConversationId;
  readonly mode: "run" | "abort";
  readonly controller: AbortController;
  readonly context: Context;
  readonly watches: Set<DocumentWatch<JsonObject>>;
  ended: boolean;
  readonly done: Promise<void>;
  readonly finish: () => void;
};

export type Phase = {
  readonly snapshot: () => RegistrySnapshot;
  readonly task: () => AnyTask;
  agent: Promise<Agent> | undefined;
};

export type Reservation = {
  readonly invocation: Invocation;
  readonly task: AnyTask;
  readonly snapshot: RegistrySnapshot;
};

export type ReportedTask = { readonly task: AnyTask | undefined } | undefined;

export type PhaseResult = {
  readonly checkpoint: Checkpoint;
  readonly failure?: { readonly error: unknown };
};

export type Decision = boolean | { readonly fault: unknown };

export type SchedulerOutcome = Extract<
  TaskOutcome<JsonValue>,
  { readonly status: "faulted" | "orphaned" }
>;

export type InvocationBinding = { readonly signal: AbortSignal; check(): void };

export type TaskNode = Pick<AnyTaskRecord, "conversationId" | "owner" | "background">;

export type Up = { readonly task: TaskId } | { readonly conversation: ConversationId };

export type Step =
  | { readonly task: TaskId; readonly node: TaskNode }
  | { readonly conversation: ConversationId }
  | { readonly unknown: true };

export type Node = TaskId | `c${number}`;

export type Overlay = {
  readonly tasks: ReadonlyMap<TaskId, AnyTaskRecord>;
  readonly edges: ReadonlyMap<ConversationId, TaskId | null>;
  links?: ReadonlyMap<Node, ReadonlySet<Node>>;
};

export type Scope = { readonly conversation: ConversationId } | { readonly roots: true };

export type WalkOptions = {
  readonly overlay?: Overlay;
  readonly crossBackground?: boolean;
  readonly enter?: (id: TaskId) => boolean;
};

export type Walked = {
  readonly id: TaskId;
  readonly node: TaskNode;
  readonly live: AnyTaskRecord | undefined;
};

export type TaskSchedulerOptions = {
  readonly session: SessionImpl;
  readonly storage: Storage;
  readonly registry: RegistryReader;
  readonly models: Models;
  readonly agent: (
    conversationId: ConversationId,
    snapshot: RegistrySnapshot,
    context: Context,
  ) => Promise<Agent>;
  readonly settings: () => Settings;
  readonly env: (
    conversationId: ConversationId,
    context: Context,
  ) => Promise<ExecutionEnv | undefined>;
  readonly now: () => number;
  readonly report: (error: unknown) => void;
  readonly settleOutcome: (
    tx: Transaction,
    record: AnyTaskRecord,
    outcome: SchedulerOutcome,
  ) => Promise<void>;
  readonly withdrawInputs: (tx: Transaction, conversationId: ConversationId) => Promise<void>;
  readonly conversation: (
    id: ConversationId,
    binding: InvocationBinding,
    context: Context,
  ) => Promise<ConversationHandle | undefined>;
  readonly context: Context;
};

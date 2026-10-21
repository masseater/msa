import type aiTypes from "@msa/ai/index.types";
import type chordTypes from "@msa/chord/index.types";

import type envTypes from "../env/index.types.ts";
import type sessionTypes from "../session/session.types.ts";
import type transactionTypes from "../session/transaction.types.ts";
import type typesModule from "./types.types.ts";

declare namespace schedulerCoreTypes {
  type AnyTaskRecord = typesModule.TaskRecord<
    chordTypes.JsonValue,
    chordTypes.JsonValue,
    chordTypes.JsonValue
  >;
  type RunnableTaskRecord = Extract<
    AnyTaskRecord,
    { readonly state: { readonly status: "pending" | "running" | "waiting" } }
  >;
  type Checkpoint = { readonly phase: string };
  type ErasedDefinition = typesModule.TaskDefinition<
    chordTypes.JsonValue,
    Checkpoint,
    chordTypes.JsonValue,
    object
  >;
  type ErasedRuntime = typesModule.TaskRuntime<
    chordTypes.JsonValue,
    Checkpoint,
    chordTypes.JsonValue,
    object
  >;
  type ErasedRunningTask = typesModule.RunningTask<
    chordTypes.JsonValue,
    Checkpoint,
    chordTypes.JsonValue
  >;
  type BlockedReason = "missing_task" | "task_too_old" | "migration_failed";
  type Resolution =
    | {
        readonly kind: "ready";
        readonly task: typesModule.AnyTask;
        readonly record: RunnableTaskRecord;
      }
    | { readonly kind: "blocked"; readonly reason: BlockedReason };
  type Fit =
    | { readonly task: typesModule.AnyTask; readonly migrates: boolean }
    | { readonly reason: BlockedReason; readonly error?: unknown };
  type Invocation = {
    readonly taskId: typesModule.TaskId;
    readonly conversationId: typesModule.ConversationId;
    readonly mode: "run" | "abort";
    readonly controller: AbortController;
    readonly context: chordTypes.Context;
    readonly watches: Set<typesModule.DocumentWatch<typesModule.JsonObject>>;
    ended: boolean;
    readonly done: Promise<void>;
    readonly finish: () => void;
  };
  type Phase = {
    readonly snapshot: () => typesModule.RegistrySnapshot;
    readonly task: () => typesModule.AnyTask;
    agent: Promise<typesModule.Agent> | undefined;
  };
  type Reservation = {
    readonly invocation: Invocation;
    readonly task: typesModule.AnyTask;
    readonly snapshot: typesModule.RegistrySnapshot;
  };
  type ReportedTask = { readonly task: typesModule.AnyTask | undefined } | undefined;
  type PhaseResult = {
    readonly checkpoint: Checkpoint;
    readonly failure?: { readonly error: unknown };
  };
  type Decision = boolean | { readonly fault: unknown };
  type SchedulerOutcome = Extract<
    typesModule.TaskOutcome<chordTypes.JsonValue>,
    { readonly status: "faulted" | "orphaned" }
  >;
  type InvocationBinding = { readonly signal: AbortSignal; check(): void };
  type TaskNode = Pick<AnyTaskRecord, "conversationId" | "owner" | "background">;
  type Up =
    | { readonly task: typesModule.TaskId }
    | { readonly conversation: typesModule.ConversationId };
  type Step =
    | { readonly task: typesModule.TaskId; readonly node: TaskNode }
    | { readonly conversation: typesModule.ConversationId }
    | { readonly unknown: true };
  type Node = typesModule.TaskId | `c${number}`;
  type Overlay = {
    readonly tasks: ReadonlyMap<typesModule.TaskId, AnyTaskRecord>;
    readonly edges: ReadonlyMap<typesModule.ConversationId, typesModule.TaskId | null>;
    links?: ReadonlyMap<Node, ReadonlySet<Node>>;
  };
  type Scope = { readonly conversation: typesModule.ConversationId } | { readonly roots: true };
  type WalkOptions = {
    readonly overlay?: Overlay;
    readonly crossBackground?: boolean;
    readonly enter?: (id: typesModule.TaskId) => boolean;
  };
  type Walked = {
    readonly id: typesModule.TaskId;
    readonly node: TaskNode;
    readonly live: AnyTaskRecord | undefined;
  };
  type TaskSchedulerOptions = {
    readonly session: sessionTypes.SessionImpl;
    readonly storage: typesModule.Storage;
    readonly registry: typesModule.RegistryReader;
    readonly models: aiTypes.Models;
    readonly agent: (
      conversationId: typesModule.ConversationId,
      snapshot: typesModule.RegistrySnapshot,
      context: chordTypes.Context,
    ) => Promise<typesModule.Agent>;
    readonly settings: () => typesModule.Settings;
    readonly env: (
      conversationId: typesModule.ConversationId,
      context: chordTypes.Context,
    ) => Promise<envTypes.ExecutionEnv | undefined>;
    readonly now: () => number;
    readonly report: (error: unknown) => void;
    readonly settleOutcome: (
      tx: transactionTypes.Transaction,
      record: AnyTaskRecord,
      outcome: SchedulerOutcome,
    ) => Promise<void>;
    readonly withdrawInputs: (
      tx: transactionTypes.Transaction,
      conversationId: typesModule.ConversationId,
    ) => Promise<void>;
    readonly conversation: (
      id: typesModule.ConversationId,
      binding: InvocationBinding,
      context: chordTypes.Context,
    ) => Promise<typesModule.ConversationHandle | undefined>;
    readonly context: chordTypes.Context;
  };
}

export type { schedulerCoreTypes as default };

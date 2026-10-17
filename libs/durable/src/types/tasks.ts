import type { Models } from "@msa/ai";
import type { Context, JsonValue } from "@msa/chord";

import type { ExecutionEnv } from "../env/index.ts";
import type {
  Agent,
  ContextView,
  ConversationHandle,
  RegistrySnapshot,
  Settings,
  SettledTask,
} from "../harness/types.ts";
import type { ConversationId, EntryId, TaskId } from "./ids.ts";
import type { Entry, EntryRecord, TypedEntry } from "./records.ts";
import type { DocumentObserver, DocumentReader, Tx } from "./session.ts";

export type RunningTask<I, S, R> = TaskRecord<I, S, R> & {
  readonly state: Extract<TaskState<S, R>, { readonly status: "running" }>;
};

export type NextTaskState<S, R> = Extract<
  TaskState<S, R>,
  { readonly status: "running" | "waiting" | "terminal" }
>;

export type PhaseHandler<I, P, S, R, H extends object> = (
  task: RunningTask<I, P, R>,
  runtime: TaskRuntime<I, S, R, H>,
  context: Context,
) => Promise<void>;

export interface HookRunner<H extends object> {
  each<K extends keyof H>(
    name: K,
    invoke: (handler: NonNullable<H[K]>) => void | Promise<void>,
  ): Promise<void>;
}

export interface TaskRuntime<I, S, R, H extends object> extends DocumentObserver, DocumentReader {
  readonly taskId: TaskId<R>;
  readonly conversationId: ConversationId;
  readonly signal: AbortSignal;
  readonly registry: RegistrySnapshot;
  agent(context: Context): Promise<Agent>;
  readonly settings: Settings;
  readonly models: Models;
  env(context: Context): Promise<ExecutionEnv | undefined>;
  readonly hooks: HookRunner<H>;

  commit(
    change: (
      tx: Tx,
      current: RunningTask<I, S, R>,
    ) => NextTaskState<S, R> | undefined | Promise<NextTaskState<S, R> | undefined>,
    context: Context,
  ): Promise<void>;
  memo<T extends JsonValue>(name: string, context: Context): Promise<T | undefined>;
  memo<T extends JsonValue>(name: string, candidate: T, context: Context): Promise<T>;
  getTask<T>(
    id: TaskId<T>,
    context: Context,
  ): Promise<TaskRecord<JsonValue, JsonValue, T> | undefined>;
  waitForTask<T>(id: TaskId<T>, context: Context): Promise<SettledTask<T>>;
  abortOwned(id: TaskId, context: Context): Promise<void>;
  ownedTasks(context: Context): Promise<TaskRecord<JsonValue, JsonValue, JsonValue>[]>;
  outcomes<T>(ids: readonly TaskId<T>[], context: Context): Promise<TaskOutcome<T>[]>;
  conversation(id: ConversationId, context: Context): Promise<ConversationHandle | undefined>;
  entry(id: EntryId, context: Context): Promise<EntryRecord | undefined>;
  entry<D extends JsonValue>(
    token: Entry<D>,
    id: EntryId,
    context: Context,
  ): Promise<TypedEntry<D> | undefined>;
  context(
    conversationId: ConversationId,
    context: Context,
    options?: { readonly at?: EntryId },
  ): Promise<ContextView>;
  now(): number;
  report(error: unknown): void;
  sleep(until: number, context: Context): Promise<void>;
}

export type TaskDefinition<I, S extends { phase: string }, R, H extends object> = {
  readonly name: string;
  readonly version: number;
  initial(input: I): S;
  readonly phases: {
    readonly [P in S["phase"]]: PhaseHandler<I, Extract<S, { phase: P }>, S, R, H>;
  };
  abort(
    task: RunningTask<I, S, R>,
    runtime: TaskRuntime<I, S, R, H>,
    context: Context,
  ): Promise<void>;
  migrate?(
    input: JsonValue,
    checkpoint: JsonValue,
    fromVersion: number,
  ): {
    input: I;
    checkpoint: S;
  };
  readonly hooks?: H;
};

export interface Task<I, S extends { phase: string }, R, H extends object> {
  readonly definition: TaskDefinition<I, S, R, H>;
}

export type TaskOwnership =
  | { readonly kind: "conversation" }
  | { readonly kind: "task"; readonly taskId: TaskId };

export type JoinPolicy = "failFast" | "allSettled";

export type TaskOptions = {
  readonly ownership: TaskOwnership;
  readonly conversationId?: ConversationId;
  readonly background?: boolean;
  readonly abandonOnRestart?: boolean;
};

export type TaskOutcomeError = {
  readonly message: string;
  readonly detail?: JsonValue;
};

export type TaskOutcome<R> =
  | {
      readonly status: "completed";
      readonly result: R;
      readonly error?: never;
      readonly reason?: never;
    }
  | {
      readonly status: "failed";
      readonly error: TaskOutcomeError;
      readonly result?: R;
      readonly reason?: never;
    }
  | {
      readonly status: "aborted";
      readonly reason?: string;
      readonly result?: R;
      readonly error?: never;
    }
  | {
      readonly status: "orphaned";
      readonly reason: string;
      readonly result?: never;
      readonly error?: never;
    }
  | {
      readonly status: "faulted";
      readonly error: TaskOutcomeError;
      readonly result?: never;
      readonly reason?: never;
    };

export type TaskState<S, R> =
  | {
      readonly status: "pending";
      readonly checkpoint: S;
      readonly outcome?: never;
    }
  | {
      readonly status: "running";
      readonly checkpoint: S;
      readonly outcome?: never;
    }
  | {
      readonly status: "waiting";
      readonly checkpoint: S;
      readonly on: readonly TaskId[];
      readonly policy: JoinPolicy;
      readonly outcome?: never;
    }
  | {
      readonly status: "completing";
      readonly checkpoint?: never;
      readonly outcome: TaskOutcome<R>;
    }
  | {
      readonly status: "terminal";
      readonly checkpoint?: never;
      readonly outcome: TaskOutcome<R>;
    };

type TaskRecordBase<I, R> = {
  readonly id: TaskId<R>;
  readonly conversationId: ConversationId;
  readonly kind: string;
  readonly version: number;
  readonly input: I;
  readonly owner?: TaskId;
  readonly background: boolean;
  readonly abortRequested: boolean;
  readonly abortReason?: "restart";
  readonly abandonOnRestart?: true;
  readonly startedAt?: number;
  readonly endedAt?: number;
};

export type TaskRecord<I, S, R> = TaskRecordBase<I, R> &
  (
    | {
        readonly state: Extract<
          TaskState<S, R>,
          { readonly status: "pending" | "running" | "waiting" }
        >;
        readonly memos?: Readonly<Record<string, JsonValue>>;
      }
    | {
        readonly state: Extract<TaskState<S, R>, { readonly status: "completing" | "terminal" }>;
        readonly memos?: never;
      }
  );

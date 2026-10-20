import type { Models } from "@msa/ai";
import type { Context, JsonValue } from "@msa/chord";

import type envTypes from "../env/index.types.ts";
import type typesModule from "../harness/types.types.ts";
import type idsTypes from "./ids.types.ts";
import type recordsTypes from "./records.ts";
import type sessionTypes from "./session.ts";

declare namespace tasksTypes {
  type RunningTask<I, S, R> = TaskRecord<I, S, R> & {
    readonly state: Extract<TaskState<S, R>, { readonly status: "running" }>;
  };

  type NextTaskState<S, R> = Extract<
    TaskState<S, R>,
    { readonly status: "running" | "waiting" | "terminal" }
  >;

  type PhaseHandler<I, P, S, R, H extends object> = (
    task: RunningTask<I, P, R>,
    runtime: TaskRuntime<I, S, R, H>,
    context: Context,
  ) => Promise<void>;

  interface HookRunner<H extends object> {
    each<K extends keyof H>(
      name: K,
      invoke: (handler: NonNullable<H[K]>) => void | Promise<void>,
    ): Promise<void>;
  }

  interface TaskRuntime<I, S, R, H extends object>
    extends sessionTypes.DocumentObserver, sessionTypes.DocumentReader {
    readonly taskId: idsTypes.TaskId<R>;
    readonly conversationId: idsTypes.ConversationId;
    readonly signal: AbortSignal;
    readonly registry: typesModule.RegistrySnapshot;
    agent(context: Context): Promise<typesModule.Agent>;
    readonly settings: typesModule.Settings;
    readonly models: Models;
    env(context: Context): Promise<envTypes.ExecutionEnv | undefined>;
    readonly hooks: HookRunner<H>;

    commit(
      change: (
        tx: sessionTypes.Tx,
        current: RunningTask<I, S, R>,
      ) => NextTaskState<S, R> | undefined | Promise<NextTaskState<S, R> | undefined>,
      context: Context,
    ): Promise<void>;
    memo<T extends JsonValue>(name: string, context: Context): Promise<T | undefined>;
    memo<T extends JsonValue>(name: string, candidate: T, context: Context): Promise<T>;
    getTask<T>(
      id: idsTypes.TaskId<T>,
      context: Context,
    ): Promise<TaskRecord<JsonValue, JsonValue, T> | undefined>;
    waitForTask<T>(id: idsTypes.TaskId<T>, context: Context): Promise<typesModule.SettledTask<T>>;
    abortOwned(id: idsTypes.TaskId, context: Context): Promise<void>;
    ownedTasks(context: Context): Promise<TaskRecord<JsonValue, JsonValue, JsonValue>[]>;
    outcomes<T>(ids: readonly idsTypes.TaskId<T>[], context: Context): Promise<TaskOutcome<T>[]>;
    conversation(
      id: idsTypes.ConversationId,
      context: Context,
    ): Promise<typesModule.ConversationHandle | undefined>;
    entry(id: idsTypes.EntryId, context: Context): Promise<recordsTypes.EntryRecord | undefined>;
    entry<D extends JsonValue>(
      token: recordsTypes.Entry<D>,
      id: idsTypes.EntryId,
      context: Context,
    ): Promise<recordsTypes.TypedEntry<D> | undefined>;
    context(
      conversationId: idsTypes.ConversationId,
      context: Context,
      options?: { readonly at?: idsTypes.EntryId },
    ): Promise<typesModule.ContextView>;
    now(): number;
    report(error: unknown): void;
    sleep(until: number, context: Context): Promise<void>;
  }

  type TaskDefinition<I, S extends { phase: string }, R, H extends object> = {
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

  interface Task<I, S extends { phase: string }, R, H extends object> {
    readonly definition: TaskDefinition<I, S, R, H>;
  }

  type TaskOwnership =
    | { readonly kind: "conversation" }
    | { readonly kind: "task"; readonly taskId: idsTypes.TaskId };

  type JoinPolicy = "failFast" | "allSettled";

  type TaskOptions = {
    readonly ownership: TaskOwnership;
    readonly conversationId?: idsTypes.ConversationId;
    readonly background?: boolean;
    readonly abandonOnRestart?: boolean;
  };

  type TaskOutcomeError = {
    readonly message: string;
    readonly detail?: JsonValue;
  };

  type TaskOutcome<R> =
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

  type TaskState<S, R> =
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
        readonly on: readonly idsTypes.TaskId[];
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
    readonly id: idsTypes.TaskId<R>;
    readonly conversationId: idsTypes.ConversationId;
    readonly kind: string;
    readonly version: number;
    readonly input: I;
    readonly owner?: idsTypes.TaskId;
    readonly background: boolean;
    readonly abortRequested: boolean;
    readonly abortReason?: "restart";
    readonly abandonOnRestart?: true;
    readonly startedAt?: number;
    readonly endedAt?: number;
  };

  type TaskRecord<I, S, R> = TaskRecordBase<I, R> &
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
}

export type { tasksTypes as default };

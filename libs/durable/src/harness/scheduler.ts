import type { Context, JsonValue } from "@msa/chord";
import { Effect } from "effect";

import type { IndexSizes } from "./scheduler-index.ts";
import { joinScheduler, openScheduler } from "./scheduler-open.ts";
import { abortConversation, abortTask, waitForTask } from "./scheduler-public.ts";
import { scheduleReconcile } from "./scheduler-reconcile.ts";
import { inspectScheduler, kick } from "./scheduler-reserve.ts";
import { SchedulerState } from "./scheduler-state.ts";
import type {
  ConversationId,
  HarnessInspection,
  RegistrySnapshot,
  SettledTask,
  TaskId,
  TaskInspection,
  TaskSchedulerOptions,
} from "./scheduler-types.ts";

export type {
  InvocationBinding,
  SchedulerOutcome,
  TaskSchedulerOptions,
} from "./scheduler-types.ts";

export class TaskScheduler {
  readonly #state: SchedulerState;

  constructor(options: TaskSchedulerOptions) {
    const state: SchedulerState = new SchedulerState(options, {
      reconcile: () => scheduleReconcile(state),
      kick: () => kick(state),
    });
    this.#state = state;
  }

  open(context: Context): Promise<void> {
    return Effect.runPromise(openScheduler(this.#state, context));
  }

  resume(): void {
    this.#state.enabled = true;
    this.#state.wake.kick();
  }

  join(): Promise<void> {
    return Effect.runPromise(joinScheduler(this.#state));
  }

  abort(id: TaskId, context: Context, keepRestart = false): Promise<"marked" | "terminal"> {
    return Effect.runPromise(abortTask(this.#state, id, context, keepRestart));
  }

  waitForTask(id: TaskId, context: Context): Promise<SettledTask<JsonValue>> {
    return Effect.runPromise(waitForTask(this.#state, id, context));
  }

  waitForIdle(conversationId: ConversationId | undefined, context: Context): Promise<void> {
    return this.#state.waitForIdle(conversationId, context);
  }

  abortConversation(
    conversationId: ConversationId,
    background: boolean,
    context: Context,
  ): Promise<void> {
    return Effect.runPromise(abortConversation(this.#state, conversationId, background, context));
  }

  get indexSizes(): IndexSizes {
    return this.#state.graph.indexSizes;
  }

  inspect(
    snapshot: RegistrySnapshot,
  ): Promise<{ scheduling: HarnessInspection["scheduling"]; tasks: TaskInspection[] }> {
    return Effect.runPromise(inspectScheduler(this.#state, snapshot));
  }
}

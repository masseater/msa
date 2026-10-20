import type { Context, JsonValue } from "@msa/chord";
import { Effect } from "effect";

import type schedulerIndexTypes from "./scheduler-index.types.ts";
import schedulerOpen from "./scheduler-open.ts";
import schedulerPublic from "./scheduler-public.ts";
import schedulerReconcile from "./scheduler-reconcile.ts";
import schedulerReserve from "./scheduler-reserve.ts";
import SchedulerState from "./scheduler-state.ts";
import type schedulerStateTypes from "./scheduler-state.types.ts";
import type schedulerTypesModule from "./scheduler-types.types.ts";

const { inspectScheduler, kick } = schedulerReserve;
const { scheduleReconcile } = schedulerReconcile;
const { joinScheduler, openScheduler } = schedulerOpen;
const { abortConversation, abortTask, waitForTask } = schedulerPublic;

export default class TaskScheduler {
  readonly #state: schedulerStateTypes.SchedulerState;

  constructor(options: schedulerTypesModule.TaskSchedulerOptions) {
    const state: schedulerStateTypes.SchedulerState = new SchedulerState(options, {
      kick: () => kick(state),
      reconcile: () => scheduleReconcile(state),
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

  abort(
    id: schedulerTypesModule.TaskId,
    context: Context,
    keepRestart = false,
  ): Promise<"marked" | "terminal"> {
    return Effect.runPromise(abortTask(this.#state, id, context, keepRestart));
  }

  waitForTask(
    id: schedulerTypesModule.TaskId,
    context: Context,
  ): Promise<schedulerTypesModule.SettledTask<JsonValue>> {
    return Effect.runPromise(waitForTask(this.#state, id, context));
  }

  waitForIdle(
    conversationId: schedulerTypesModule.ConversationId | undefined,
    context: Context,
  ): Promise<void> {
    return this.#state.waitForIdle(conversationId, context);
  }

  abortConversation(
    conversationId: schedulerTypesModule.ConversationId,
    background: boolean,
    context: Context,
  ): Promise<void> {
    return Effect.runPromise(abortConversation(this.#state, conversationId, background, context));
  }

  get indexSizes(): schedulerIndexTypes.IndexSizes {
    return this.#state.graph.indexSizes;
  }

  inspect(snapshot: schedulerTypesModule.RegistrySnapshot): Promise<{
    scheduling: schedulerTypesModule.HarnessInspection["scheduling"];
    tasks: schedulerTypesModule.TaskInspection[];
  }> {
    return Effect.runPromise(inspectScheduler(this.#state, snapshot));
  }
}

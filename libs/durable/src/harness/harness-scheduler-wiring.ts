import type { Context } from "@msa/chord";
import { withoutAbortSignal } from "@msa/chord/context";
import { Effect } from "effect";

import { boundConversation } from "./harness-bound.ts";
import { withdrawQueuedInputs } from "./inbox.ts";
import { settleSchedulerOutcome } from "./live-settle.ts";
import { TaskScheduler, type TaskSchedulerOptions } from "./scheduler.ts";
import type {
  Agent,
  ConversationId,
  HarnessOptions,
  RegistrySnapshot,
  Settings,
  Storage,
  ToolRegistration,
} from "./types.ts";

export type SchedulerHost<Tool extends ToolRegistration> = TaskSchedulerOptions["session"] & {
  resolveAgent(
    id: ConversationId,
    snapshot: RegistrySnapshot<Tool> | undefined,
    context: Context,
  ): Promise<Agent<Tool>>;
  buildEnv: TaskSchedulerOptions["env"];
};

export type SchedulerWiring<Tool extends ToolRegistration> = {
  readonly host: SchedulerHost<Tool>;
  readonly storage: Storage;
  readonly options: HarnessOptions<Tool>;
  readonly settings: () => Settings;
  readonly now: () => number;
  readonly report: (error: unknown) => void;
  readonly submissions: () => Parameters<typeof boundConversation>[2];
  readonly context: Context;
};

export const createTaskScheduler = <Tool extends ToolRegistration>(
  wiring: SchedulerWiring<Tool>,
): TaskScheduler => {
  const { host, storage, options } = wiring;
  const tasks: TaskScheduler = new TaskScheduler({
    session: host,
    storage,
    registry: options.registry,
    models: options.models,
    agent: (id, snapshot, callContext) =>
      host.resolveAgent(id, snapshot as RegistrySnapshot<Tool>, callContext),
    settings: wiring.settings,
    env: (id, callContext) => host.buildEnv(id, callContext),
    now: wiring.now,
    report: wiring.report,
    settleOutcome: (tx, record, outcome) =>
      Effect.runPromise(settleSchedulerOutcome(tx, record, outcome)),
    withdrawInputs: (tx, conversationId) =>
      Effect.runPromise(withdrawQueuedInputs(tx, conversationId)),
    conversation: (id, binding, callContext) =>
      Effect.runPromise(
        Effect.map(
          Effect.promise(() => host.readOnLine(() => storage.conversation(id, callContext))),
          (record) =>
            record === undefined
              ? undefined
              : boundConversation(id, binding, wiring.submissions(), tasks),
        ),
      ),
    context: withoutAbortSignal(wiring.context),
  });
  return tasks;
};

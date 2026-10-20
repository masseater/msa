import { withoutAbortSignal } from "@msa/chord/context";
import { Effect } from "effect";

import harnessBound from "./harness-bound.ts";
import type harnessSchedulerWiringTypes from "./harness-scheduler-wiring.types.ts";
import inboxModule from "./inbox.ts";
import liveSettle from "./live-settle.ts";
import TaskScheduler from "./scheduler.ts";
import type schedulerTypes from "./scheduler.types.ts";
import type typesModule from "./types.types.ts";

const { boundConversation } = harnessBound;

const { settleSchedulerOutcome } = liveSettle;
const { withdrawQueuedInputs } = inboxModule;

const createTaskScheduler = <Tool extends typesModule.ToolRegistration>(
  wiring: harnessSchedulerWiringTypes.SchedulerWiring<Tool>,
): schedulerTypes.TaskScheduler => {
  const { host, storage, options } = wiring;
  const tasks: schedulerTypes.TaskScheduler = new TaskScheduler({
    agent: (id, snapshot, callContext) =>
      host.resolveAgent(id, snapshot as typesModule.RegistrySnapshot<Tool>, callContext),
    context: withoutAbortSignal(wiring.context),
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
    env: (id, callContext) => host.buildEnv(id, callContext),
    models: options.models,
    now: wiring.now,
    registry: options.registry,
    report: wiring.report,
    session: host,
    settings: wiring.settings,
    settleOutcome: (tx, record, outcome) =>
      Effect.runPromise(settleSchedulerOutcome(tx, record, outcome)),
    storage,
    withdrawInputs: (tx, conversationId) =>
      Effect.runPromise(withdrawQueuedInputs(tx, conversationId)),
  });
  return tasks;
};

const harnessSchedulerWiring = {
  createTaskScheduler,
};

export default harnessSchedulerWiring;

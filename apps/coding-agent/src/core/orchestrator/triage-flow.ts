import { Effect } from "effect";

import resumeModule from "./resume.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import triageMemory from "./triage-memory.ts";
import triageOutcome from "./triage-outcome.ts";
import type triageOutcomeTypes from "./triage-outcome.types.ts";
import triageRestart from "./triage-restart.ts";
import triageText from "./triage-text.ts";

const { store } = storeModule;
const { resuming } = resumeModule;

type Applied = triageOutcomeTypes.Applied;

function startTriage(
  runtime: runtimeTypes.Runtime,
  applied: Applied,
  ask: Applied["triage"][number],
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const task = store.getTask(runtime.database, ask.taskId);
    if (task === undefined) return;
    if (yield* triageMemory.repeats(runtime, ask)) {
      yield* triageMemory.escalate(runtime, task.id);
      applied.status = triageOutcome.worse(applied.status, "needs-decision");
      applied.lines.push(triageText.repeatLine(ask.request));
      return;
    }
    yield* triageRestart.launchTriage(runtime, task, ask);
  });
}

function followUps(
  runtime: runtimeTypes.Runtime,
  applied: Applied,
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    for (const ask of applied.triage) yield* startTriage(runtime, applied, ask);
    for (const item of applied.resumes) {
      yield* triageMemory.remember(runtime, item.task.id, item.ask);
      yield* resuming.resume(runtime, item.task, item.decision, "triage");
    }
  });
}

const triageFlow = { followUps, restartInterrupted: triageRestart.restartInterrupted };

export default triageFlow;

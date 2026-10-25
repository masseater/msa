import { Effect } from "effect";

import advisorWorkspace from "./advisor-workspace.ts";
import type outcomeApply from "./outcome-apply.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import start from "./start.ts";
import threadTools from "./thread-tools.ts";
import triageFlow from "./triage-flow.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { starting } = start;
const { scheduling } = schedule;

interface Settled {
  applied: ReturnType<typeof outcomeApply.applyOutcome>;
  assignments: readonly orchestratorTypesTypes.Assignment[];
  cwd: string;
  report: string;
}

function startFollowUps(
  runtime: runtimeTypes.Runtime,
  settled: Settled,
): Effect.Effect<string[], runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const { applied, report } = settled;
    if (settled.assignments.some((assignment) => threadTools.readOnly(assignment.role))) {
      yield* advisorWorkspace.remove(settled.cwd);
    }
    yield* triageFlow.followUps(runtime, applied);
    for (const task of applied.review) {
      yield* starting.startTasks(runtime, task, "reviewer", report);
    }
    for (const item of applied.sendBack) {
      yield* starting.startTasks(runtime, item.task, "worker", "", item.prompt);
    }
    const scheduled = yield* scheduling.scheduleEffect(runtime);
    return [...applied.sendBack.map((item) => item.task.id), ...scheduled];
  });
}

const settleFollowUps = { startFollowUps };

export default settleFollowUps;

import { Effect } from "effect";

import type errorsTypes from "./errors.types.ts";
import ids from "./ids.ts";
import replanApplyPart1 from "./replan-apply-part1.ts";
import replanApplyPart3 from "./replan-apply-part3.ts";
import type replanTypes from "./replan.types.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { nowMillis } = runtimeModule;
const { newId } = ids;
const { scheduling } = schedule;
const { collect } = replanApplyPart1;
const { write } = replanApplyPart3;

function apply(
  runtime: runtimeTypes.Runtime,
  prepared: replanTypes.Prepared,
  memos: ReadonlyMap<string, string>,
): Effect.Effect<orchestratorTypesTypes.ReplanResult, errorsTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const replanId = newId("rp");
    const handoffs = yield* collect(runtime, memos);
    const changes = yield* Effect.sync(() => write(runtime, prepared, handoffs, replanId, now));
    runtime.replanning = false;
    yield* Effect.sync(() => runtime.publish());
    const started =
      prepared.input.resume === false ? [] : yield* scheduling.scheduleEffect(runtime);
    yield* Effect.sync(() => runtime.publish());
    return {
      aborted: null,
      created: changes.created,
      dropped: changes.dropped,
      kept: changes.kept,
      replanId,
      rewired: changes.rewired,
      started,
      stopped: changes.stopped,
    };
  });
}

const replanApplyPart4 = {
  apply,
};

export default replanApplyPart4;

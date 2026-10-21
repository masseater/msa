import elapsedModule from "../../utils/elapsed.ts";
import type outcomeTypes from "./outcome.types.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { formatElapsed } = elapsedModule;
const { store } = storeModule;

function runTimeSuffix(
  runtime: runtimeTypes.Runtime,
  assignments: readonly orchestratorTypesTypes.Assignment[],
  outcome: outcomeTypes.Outcome,
): string {
  if (outcome.status === "completed") return "";
  const threadId = assignments[0]?.threadId;
  const thread = threadId === undefined ? undefined : store.getThread(runtime.database, threadId);
  if (thread === undefined) return "";
  return ` The thread ran for ${formatElapsed(thread.updatedAt - thread.createdAt)}.`;
}

const runTimeNotice = { runTimeSuffix };

export default runTimeNotice;

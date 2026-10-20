import { Effect } from "effect";

import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import type orchestratorTypesTypes from "../src/core/orchestrator/types.types.ts";
import orchestratorHarness from "./orchestrator-harness.ts";

const { harness } = orchestratorHarness;

const { waitFor } = harness;

const create = (
  orchestrator: orchestratorTypes.Orchestrator,
  input: Parameters<orchestratorTypes.Orchestrator["createTask"]>[0],
) => Effect.promise(() => orchestrator.createTask(input));

const read = (orchestrator: orchestratorTypes.Orchestrator, id: string) =>
  Effect.promise(() => orchestrator.read(id));

function replan(
  orchestrator: orchestratorTypes.Orchestrator,
  input: orchestratorTypesTypes.ReplanInput,
): Promise<unknown> {
  return orchestrator.replan(input).catch((error: unknown) => error);
}

function stopAndWrapUp(
  orchestrator: orchestratorTypes.Orchestrator,
  workers: { prompts: string[]; complete: (reply: string) => void }[],
  memo: string,
) {
  return Effect.gen(function* () {
    yield* waitFor(() => orchestrator.replanning);
    for (const worker of workers) worker.complete("turn done");
    yield* waitFor(() => workers.every((worker) => worker.prompts.length === 2));
    for (const worker of workers) worker.complete(memo);
  });
}

const orchestratorReplanSupport = {
  create,
  read,
  replan,
  stopAndWrapUp,
};

export default orchestratorReplanSupport;

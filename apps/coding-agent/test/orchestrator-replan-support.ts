import { Effect } from "effect";

import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
import type { ReplanInput } from "../src/core/orchestrator/types.ts";
import orchestratorHarness from "./orchestrator-harness.ts";

const { harness } = orchestratorHarness;

const { waitFor } = harness;

const create = (orchestrator: Orchestrator, input: Parameters<Orchestrator["createTask"]>[0]) =>
  Effect.promise(() => orchestrator.createTask(input));

const read = (orchestrator: Orchestrator, id: string) =>
  Effect.promise(() => orchestrator.read(id));

function replan(orchestrator: Orchestrator, input: ReplanInput): Promise<unknown> {
  return orchestrator.replan(input).catch((error: unknown) => error);
}

function stopAndWrapUp(
  orchestrator: Orchestrator,
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

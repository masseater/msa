import { Effect } from "effect";

import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
const create = (orchestrator: Orchestrator, input: Parameters<Orchestrator["createTask"]>[0]) =>
  Effect.promise(() => orchestrator.createTask(input));

const orchestratorSupport = {
  create,
};

export default orchestratorSupport;

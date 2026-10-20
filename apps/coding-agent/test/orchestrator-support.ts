import { Effect } from "effect";

import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
const create = (
  orchestrator: orchestratorTypes.Orchestrator,
  input: Parameters<orchestratorTypes.Orchestrator["createTask"]>[0],
) => Effect.promise(() => orchestrator.createTask(input));

const orchestratorSupport = {
  create,
};

export default orchestratorSupport;

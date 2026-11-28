import { Effect } from "effect";

import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";

type CreateInput = Parameters<orchestratorTypes.Orchestrator["createTask"]>[0];

const create = (orchestrator: orchestratorTypes.Orchestrator, input: CreateInput) =>
  Effect.promise(() => orchestrator.createTask(input));

const createNamed = (
  orchestrator: orchestratorTypes.Orchestrator,
  name: string,
  rest: Omit<CreateInput, "currentState" | "goalState" | "title"> = {},
) =>
  create(orchestrator, {
    currentState: `${name} is not written`,
    goalState: `${name} works`,
    title: name,
    ...rest,
  });

const orchestratorSupport = {
  create,
  createNamed,
};

export default orchestratorSupport;

import { Effect, Result } from "effect";

import errors from "../src/core/orchestrator/errors.ts";
import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import type FakeWorker from "./fake-worker.ts";
import orchestratorHarness from "./orchestrator-harness.ts";

const { orchestratorError } = errors;

const { waitFor } = orchestratorHarness.harness;

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

const read = (orchestrator: orchestratorTypes.Orchestrator, id: string) =>
  Effect.promise(() => orchestrator.read(id));

const failureMessageOf = <A>(run: () => Promise<A>): Effect.Effect<string> =>
  Effect.flatMap(
    Effect.result(Effect.tryPromise({ catch: orchestratorError, try: run })),
    (result) =>
      Result.isFailure(result)
        ? Effect.succeed(result.failure.message)
        : Effect.die(new Error("the call was expected to fail")),
  );

const finishWorkAndReview = (
  workers: readonly FakeWorker[],
  index: number,
  work: string,
  review: string,
) =>
  Effect.gen(function* () {
    workers[index]?.complete(work);
    yield* waitFor(() => workers.length === index + 2);
    workers[index + 1]?.complete(review);
  });

const orchestratorSupport = {
  create,
  createNamed,
  failureMessageOf,
  finishWorkAndReview,
  read,
};

export default orchestratorSupport;

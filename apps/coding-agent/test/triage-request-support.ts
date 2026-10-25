import { Effect } from "effect";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import triageSupport from "./triage-support.ts";

const { create } = orchestratorSupport;
const { setup, taskStatus, waitFor } = orchestratorHarness.harness;
const { runningTriage } = triageSupport;

const REQUEST = {
  options: [
    { choice: "Keep the old API beside the new one", tradeoffs: "Two APIs to keep" },
    { choice: "Drop the old API", tradeoffs: "Breaks callers outside the goal" },
  ],
  unmet: "The goal asks to remove the old API and to keep every caller working; both cannot hold.",
};

const DECIDED = {
  conclusion: "decided",
  decision:
    "Route the old API's callers through an adapter over the new API, then remove the old API.",
  goalItems: [
    { how: "The old API is deleted once the adapter carries its callers.", item: 1 },
    { how: "Every caller goes through the adapter and keeps working.", item: 2 },
  ],
  grounds: "Both items hold with the adapter; the commit log already moved two APIs this way.",
};

const GOAL = ["- the old API is gone", "- every caller still works"].join("\n");

const stoppedTask = (repository: string) =>
  Effect.gen(function* () {
    const setUp = setup({ cwd: repository });
    const statuses: (string | undefined)[] = [];
    const task = yield* create(setUp.orchestrator, {
      currentState: "the old API is used by every caller",
      goalState: GOAL,
      title: "remove the old API",
    });
    const dependent = yield* create(setUp.orchestrator, {
      currentState: "the docs describe the old API",
      dependsOn: [task.id],
      goalState: "the docs describe the new API",
      title: "update the docs",
    });
    setUp.orchestrator.onChange(() => statuses.push(taskStatus(setUp.orchestrator, task.id)));
    const worker = setUp.workers[0]!;
    yield* Effect.promise(() => worker.requestDecision(REQUEST, "Stopping for a decision."));
    yield* waitFor(() => runningTriage(setUp.workers) !== undefined);
    return { ...setUp, dependent, statuses, task, triage: runningTriage(setUp.workers)!, worker };
  });

const decideOnce = (repository: string) =>
  Effect.gen(function* () {
    const stopped = yield* stoppedTask(repository);
    yield* Effect.promise(() => stopped.triage.concludeTriage(DECIDED));
    yield* waitFor(() => stopped.worker.prompts.length === 2);
    return stopped;
  });

const triageRequestSupport = { DECIDED, GOAL, REQUEST, decideOnce, stoppedTask };

export default triageRequestSupport;

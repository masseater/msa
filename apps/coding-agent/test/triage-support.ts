import { Effect } from "effect";

import type FakeWorker from "./fake-worker.ts";
import orchestratorHarness from "./orchestrator-harness.ts";

const { waitFor } = orchestratorHarness.harness;

function isTriage(worker: FakeWorker): boolean {
  return worker.tools.some((tool) => tool.name === "conclude_triage");
}

function runningTriage(workers: readonly FakeWorker[]): FakeWorker | undefined {
  return workers.find((worker) => isTriage(worker) && worker.isStreaming);
}

const escalateTriage = (workers: readonly FakeWorker[]) =>
  Effect.gen(function* () {
    yield* waitFor(() => runningTriage(workers) !== undefined);
    const triage = runningTriage(workers)!;
    yield* Effect.promise(() => triage.escalate());
    return triage;
  });

const triageSupport = { escalateTriage, isTriage, runningTriage };

export default triageSupport;

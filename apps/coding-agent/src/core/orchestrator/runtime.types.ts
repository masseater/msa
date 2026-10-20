import type { DatabaseSync } from "node:sqlite";

import type { Effect } from "effect";

import type telemetryTypesNs from "./telemetry.types.ts";
import type workerTypes from "./worker.ts";
import type wrapUpTypes from "./wrap-up.types.ts";

declare namespace runtimeTypes {
  interface Runtime {
    database: DatabaseSync;
    options: workerTypes.OrchestratorOptions;
    telemetry: telemetryTypesNs.OrchestratorTelemetry;
    workers: Map<string, workerTypes.WorkerSession>;
    runs: Map<string, number>;
    runStartedAt: Map<string, number>;
    wrapUps: Map<string, wrapUpTypes.WrapUp>;
    replanning: boolean;
    maxConcurrentThreads: number;
    nextRun(): number;
    exclusive<A>(effect: Effect.Effect<A, unknown>): Promise<A>;
    publish(): void;
    settle(
      threadId: string,
      run: number,
      worker: workerTypes.WorkerSession,
      error: unknown,
    ): Promise<void>;
    afterTurn(threadId: string, run: number, worker: workerTypes.WorkerSession): void;
  }
}

export type { runtimeTypes as default };

import type { Effect } from "effect";

import type DatabaseSync from "../platform/node/sqlite.ts";
import type errorsTypes from "./errors.types.ts";
import type reviewChecklistTypes from "./review-checklist.types.ts";
import type telemetryTypesNs from "./telemetry.types.ts";
import type triageTypes from "./triage.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import type workerTypes from "./worker.ts";
import type wrapUpTypes from "./wrap-up.types.ts";

declare namespace runtimeTypes {
  type OrchestratorError = errorsTypes.OrchestratorError;

  type WorkerSession = workerTypes.WorkerSession;

  type OrchestratorOptions = workerTypes.OrchestratorOptions;

  interface ThreadActivity {
    messages: number;
    at: number;
  }

  type MergeOutcome =
    | { kind: "merged"; line: string }
    | { kind: "sent-back"; line: string; prompt: string }
    | { kind: "needs-decision"; line: string }
    | { kind: "stopped"; line: string };

  interface DecisionAsk {
    text: string;
    key: string;
  }

  interface ReviewVerdict {
    result: orchestratorTypesTypes.ReviewVerdictResult;
    reason: string;
    stuck: boolean;
    checklist?: string;
    merge?: MergeOutcome;
  }

  interface Runtime {
    database: DatabaseSync;
    options: OrchestratorOptions;
    telemetry: telemetryTypesNs.OrchestratorTelemetry;
    workers: Map<string, workerTypes.WorkerSession>;
    runs: Map<string, number>;
    runStartedAt: Map<string, number>;
    activity: Map<string, ThreadActivity>;
    wrapUps: Map<string, wrapUpTypes.WrapUp>;
    decisionRequests: Map<string, DecisionAsk>;
    triageConclusions: Map<string, triageTypes.Conclusion>;
    goalChecklists: Map<string, reviewChecklistTypes.Checklist>;
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
      verdict?: ReviewVerdict,
      decision?: DecisionAsk,
    ): Promise<boolean>;
    afterTurn(threadId: string, run: number, worker: workerTypes.WorkerSession): void;
  }
}

export type { runtimeTypes as default };

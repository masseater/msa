import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import type FakeWorkerClass from "./fake-worker.ts";

declare namespace orchestratorHarnessTypes {
  interface HarnessOptions {
    maxConcurrent?: number;
    pollIntervalMs?: number | null;
    ciPollMs?: number;
    ciWaitMs?: number;
    ciAppearMs?: number;
    project?: string;
    runCommand?: orchestratorTypes.OrchestratorOptions["runCommand"];
    runGh?: orchestratorTypes.OrchestratorOptions["runGh"];
    decide?: orchestratorTypes.OrchestratorOptions["decide"];
    databasePath?: string;
    handoffDirectory?: string;
    cwd?: string;
  }

  type FakeWorker = (typeof FakeWorkerClass)["prototype"];
}

export type { orchestratorHarnessTypes as default };

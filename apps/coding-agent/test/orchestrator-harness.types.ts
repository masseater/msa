import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import type FakeWorkerClass from "./fake-worker.ts";

declare namespace orchestratorHarnessTypes {
  interface HarnessOptions {
    maxConcurrent?: number;
    pollIntervalMs?: number | null;
    watchdog?: orchestratorTypes.OrchestratorOptions["watchdog"];
    project?: string;
    runCondition?: (command: string, cwd: string) => Promise<boolean>;
    databasePath?: string;
    handoffDirectory?: string;
    cwd?: string;
  }

  type FakeWorker = (typeof FakeWorkerClass)["prototype"];
}

export type { orchestratorHarnessTypes as default };

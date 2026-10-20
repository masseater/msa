import type orchestratorHarness from "./orchestrator-harness.ts";

declare namespace orchestratorHarnessTypes {
  interface HarnessOptions {
    maxConcurrent?: number;
    pollIntervalMs?: number | null;
    runCondition?: (command: string, cwd: string) => Promise<boolean>;
    databasePath?: string;
    handoffDirectory?: string;
    cwd?: string;
  }

  type FakeWorker = (typeof orchestratorHarness.FakeWorker)["prototype"];
}

export type { orchestratorHarnessTypes as default };

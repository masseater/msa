import type FakeWorkerClass from "./fake-worker.ts";

declare namespace orchestratorHarnessTypes {
  interface HarnessOptions {
    maxConcurrent?: number;
    pollIntervalMs?: number | null;
    runCondition?: (command: string, cwd: string) => Promise<boolean>;
    databasePath?: string;
    handoffDirectory?: string;
    cwd?: string;
  }

  type FakeWorker = (typeof FakeWorkerClass)["prototype"];
}

export type { orchestratorHarnessTypes as default };

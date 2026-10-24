import type runtimeTypes from "./runtime.types.ts";
import type workerTypes from "./worker.ts";

declare namespace threadRunTypes {
  interface ThreadRun {
    runtime: runtimeTypes.Runtime;
    threadId: string;
    run: number;
    worker: workerTypes.WorkerSession;
  }
}

export type { threadRunTypes as default };

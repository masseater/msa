import { Effect, type Fiber } from "effect";

import backgroundModule from "./background.ts";
import runtime from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import settleModule from "./settle.ts";
import snapshotModule from "./snapshot.ts";
import storeModule from "./store.ts";
import OrchestratorTelemetry from "./telemetry.ts";
import type workerTypes from "./worker.ts";
import type wrapUpTypes from "./wrap-up.types.ts";

const { snapshots } = snapshotModule;
const { nowMillis } = runtime;
const { store } = storeModule;
const { background } = backgroundModule;
const { settling } = settleModule;

type Snapshot = ReturnType<typeof snapshots.buildSnapshot>;

const EMPTY: Snapshot = {
  maxConcurrentThreads: 4,
  replans: [],
  rounds: [],
  tasks: [],
  threads: [],
};

export default class OrchestratorState implements runtimeTypes.Runtime {
  readonly database: ReturnType<typeof store.openDatabase>;
  readonly options: workerTypes.OrchestratorOptions;
  readonly telemetry: OrchestratorTelemetry;
  readonly workers = new Map<string, workerTypes.WorkerSession>();
  readonly runs = new Map<string, number>();
  readonly runStartedAt = new Map<string, number>();
  readonly activity = new Map<string, runtimeTypes.ThreadActivity>();
  readonly wrapUps = new Map<string, wrapUpTypes.WrapUp>();
  readonly listeners = new Set<() => void>();
  replanning = false;
  snapshot: Snapshot = EMPTY;
  maxConcurrentThreads: number;
  private queue: Promise<void> = Promise.resolve();
  private runCount = 0;
  private fibers: Fiber.Fiber<never, never>[] = [];

  constructor(options: workerTypes.OrchestratorOptions) {
    this.telemetry = new OrchestratorTelemetry(options.telemetry);
    this.options = {
      ...options,
      report: (text, details) => {
        this.telemetry.reported(text, details);
        options.report(text, details);
      },
    };
    this.database = store.openDatabase(options.databasePath);
    store.recoverRunning(this.database, options.project, Effect.runSync(nowMillis));
    this.maxConcurrentThreads =
      store.storedMaxConcurrent(this.database, options.project) ??
      options.defaults().maxConcurrentThreads;
    this.publish();
    this.fibers = background.start(this);
  }

  nextRun(): number {
    this.runCount += 1;
    return this.runCount;
  }

  exclusive<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    const run = this.queue.then(() => Effect.runPromise(effect));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  publish(): void {
    this.snapshot = snapshots.buildSnapshot(
      this.database,
      this.options.project,
      this.maxConcurrentThreads,
    );
    this.telemetry.published(this.snapshot, this.runs.size);
    for (const listener of this.listeners) listener();
  }

  settle(
    threadId: string,
    run: number,
    worker: workerTypes.WorkerSession,
    error: unknown,
  ): Promise<void> {
    return settling.settle(this, threadId, run, worker, error);
  }

  afterTurn(threadId: string, run: number, worker: workerTypes.WorkerSession): void {
    settling.afterTurn(this, threadId, run, worker);
  }

  dispose(): Promise<void> {
    const fibers = this.fibers;
    this.fibers = [];
    this.telemetry.close();
    const self = this;
    return Effect.runPromise(
      Effect.gen(function* () {
        yield* background.stop(fibers);
        self.runs.clear();
        for (const worker of self.workers.values()) {
          yield* Effect.tryPromise({
            catch: () => undefined,
            try: () => worker.run.lifecycle.abort(),
          });
          worker.dispose();
        }
        self.workers.clear();
        yield* Effect.sync(() => self.database.close());
      }),
    );
  }
}

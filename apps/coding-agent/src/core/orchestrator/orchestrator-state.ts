import { Effect, FiberSet, Scope } from "effect";

import afterTurnModule from "./after-turn.ts";
import backgroundModule from "./background.ts";
import runtime from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import settleModule from "./settle.ts";
import snapshotModule from "./snapshot.ts";
import storeModule from "./store.ts";
import OrchestratorTelemetry from "./telemetry.ts";
import type wrapUpTypes from "./wrap-up.types.ts";

const { snapshots } = snapshotModule;
const { nowMillis } = runtime;
const { store } = storeModule;
const { background } = backgroundModule;
const { settling } = settleModule;
const { afterTurns } = afterTurnModule;

type Snapshot = ReturnType<typeof snapshots.buildSnapshot>;

function fiberSet<A>(): FiberSet.FiberSet<A, never> {
  return Effect.runSync(FiberSet.make<A, never>().pipe(Scope.provide(Scope.makeUnsafe())));
}

function forkInto<A>(set: FiberSet.FiberSet<A, never>, effect: Effect.Effect<A>): void {
  FiberSet.addUnsafe(set, Effect.runFork(effect));
}

const EMPTY: Snapshot = {
  maxConcurrentThreads: 4,
  replans: [],
  rounds: [],
  tasks: [],
  threads: [],
};

export default class OrchestratorState implements runtimeTypes.Runtime {
  readonly database: ReturnType<typeof store.openDatabase>;
  readonly options: runtimeTypes.OrchestratorOptions;
  readonly telemetry: OrchestratorTelemetry;
  readonly workers = new Map<string, runtimeTypes.WorkerSession>();
  readonly runs = new Map<string, number>();
  readonly runStartedAt = new Map<string, number>();
  readonly activity = new Map<string, runtimeTypes.ThreadActivity>();
  readonly wrapUps = new Map<string, wrapUpTypes.WrapUp>();
  readonly decisionRequests: runtimeTypes.Runtime["decisionRequests"] = new Map();
  readonly triageConclusions: runtimeTypes.Runtime["triageConclusions"] = new Map();
  readonly goalChecklists: runtimeTypes.Runtime["goalChecklists"] = new Map();
  readonly listeners = new Set<() => void>();
  replanning = false;
  closing = false;
  snapshot: Snapshot = EMPTY;
  maxConcurrentThreads: number;
  private queue: Promise<void> = Promise.resolve();
  private runCount = 0;
  private readonly loops = fiberSet<never>();
  private readonly launched = fiberSet<void>();
  private disposed: Promise<void> | undefined;

  constructor(options: runtimeTypes.OrchestratorOptions) {
    this.telemetry = new OrchestratorTelemetry(options.telemetry);
    this.options = {
      ...options,
      report: (text, details) => {
        this.telemetry.reported(text, details);
        options.report(text, details);
      },
    };
    this.database = store.openDatabase(options.databasePath);
    this.maxConcurrentThreads =
      store.storedMaxConcurrent(this.database, options.project) ??
      options.defaults().maxConcurrentThreads;
    for (const loop of background.start(this, Effect.runSync(nowMillis))) {
      forkInto(this.loops, loop);
    }
    this.publish();
  }

  launch(effect: Effect.Effect<unknown>): void {
    forkInto(this.launched, Effect.asVoid(effect));
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
    worker: runtimeTypes.WorkerSession,
    error: unknown,
    verdict?: runtimeTypes.ReviewVerdict,
    decision?: runtimeTypes.DecisionAsk,
  ): Promise<boolean> {
    return settling.settle(this, threadId, run, worker, error, verdict, decision);
  }

  afterTurn(threadId: string, run: number, worker: runtimeTypes.WorkerSession): void {
    afterTurns.afterTurn(this, threadId, run, worker);
  }

  dispose(): Promise<void> {
    this.disposed ??= this.close();
    return this.disposed;
  }

  private drain(): Effect.Effect<void> {
    const queue = this.queue;
    return Effect.flatMap(
      Effect.promise(() => queue),
      () => (queue === this.queue ? Effect.void : this.drain()),
    );
  }

  private close(): Promise<void> {
    this.closing = true;
    this.telemetry.close();
    const self = this;
    return Effect.runPromise(
      Effect.gen(function* () {
        yield* FiberSet.clear(self.loops);
        self.runs.clear();
        for (const worker of self.workers.values()) {
          yield* Effect.tryPromise({
            catch: () => undefined,
            try: () => worker.run.lifecycle.abort(),
          });
          worker.dispose();
        }
        self.workers.clear();
        if (!self.database.isOpen) return;
        yield* FiberSet.awaitEmpty(self.launched);
        yield* self.drain();
        const now = yield* nowMillis;
        if (!self.database.isOpen) return;
        yield* background.close(self, now);
        yield* Effect.sync(() => self.database.close());
      }),
    );
  }
}

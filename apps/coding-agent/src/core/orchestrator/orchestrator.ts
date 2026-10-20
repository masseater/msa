import type agentTypes from "@msa/agent-core/index.types";
import { Effect, Fiber } from "effect";

import actionsModule from "./actions.ts";
import handoffModule from "./handoff.ts";
import type handoffTypes from "./handoff.types.ts";
import replanModule from "./replan.ts";
import runtime from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import settleModule from "./settle.ts";
import snapshotModule from "./snapshot.ts";
import type snapshotTypes from "./snapshot.types.ts";
import storeModule from "./store.ts";
import OrchestratorTelemetry from "./telemetry.ts";
import type telemetryTypesNs from "./telemetry.types.ts";
import TranscriptCache from "./transcripts.ts";
import type workerTypes from "./worker.ts";
import type wrapUpTypes from "./wrap-up.types.ts";

const { handoffs } = handoffModule;
const { snapshots } = snapshotModule;
const { nowMillis } = runtime;
const { store } = storeModule;
const { scheduling } = schedule;
const { settling } = settleModule;
const { actions } = actionsModule;
const { replan } = replanModule;

const EMPTY: snapshotTypes.OrchestratorSnapshot = {
  maxConcurrentThreads: 4,
  replans: [],
  rounds: [],
  tasks: [],
  threads: [],
};
export default class Orchestrator implements runtimeTypes.Runtime {
  readonly database: ReturnType<typeof store.openDatabase>;
  readonly options: workerTypes.OrchestratorOptions;
  readonly telemetry: telemetryTypesNs.OrchestratorTelemetry;
  readonly workers = new Map<string, workerTypes.WorkerSession>();
  readonly runs = new Map<string, number>();
  readonly runStartedAt = new Map<string, number>();
  readonly wrapUps = new Map<string, wrapUpTypes.WrapUp>();
  readonly listeners = new Set<() => void>();
  replanning = false;
  snapshot: snapshotTypes.OrchestratorSnapshot = EMPTY;
  maxConcurrentThreads: number;
  private readonly transcripts = new TranscriptCache();
  private queue: Promise<void> = Promise.resolve();
  private runCount = 0;
  private poller: Fiber.Fiber<never, never> | undefined;

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
    if (options.pollIntervalMs !== null) {
      this.poller = scheduling.startPolling(this, options.pollIntervalMs ?? 5000);
    }
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

  get tasks(): readonly snapshotTypes.TaskView[] {
    return this.snapshot.tasks;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  messages(id: string): readonly agentTypes.AgentMessage[] {
    const sessionFile = this.snapshot.threads.find((thread) => thread.id === id)?.sessionFile;
    return this.transcripts.messages(id, this.workers, sessionFile ?? null);
  }

  progress(id: string): { startedAt: number | undefined; retrying: boolean } {
    return {
      retrying: this.workers.get(id)?.run.retry.isRetrying ?? false,
      startedAt: this.runs.has(id) ? this.runStartedAt.get(id) : undefined,
    };
  }

  refresh(): Promise<void> {
    return this.exclusive(Effect.sync(() => this.publish()));
  }

  list(): Promise<snapshotTypes.TaskView[]> {
    return this.refresh().then(() => [...this.snapshot.tasks]);
  }

  read(id: string): Promise<snapshotTypes.TaskView> {
    return this.refresh().then(() => {
      const found = this.snapshot.tasks.find((task) => task.id === id);
      if (found === undefined) throw new Error(`Unknown task: ${id}`);
      return found;
    });
  }

  createTask(input: snapshotTypes.CreateTaskInput): Promise<snapshotTypes.TaskView> {
    return this.exclusive(actions.createTask(this, input));
  }

  setDepends(input: snapshotTypes.SetTaskDependsInput): Promise<snapshotTypes.TaskView[]> {
    return this.exclusive(actions.setDepends(this, input));
  }

  setState(input: snapshotTypes.SetTaskStateInput): Promise<snapshotTypes.TaskView> {
    return this.exclusive(actions.setState(this, input));
  }

  setModel(
    taskId: string,
    model: string,
    thinkingLevel?: snapshotTypes.TaskView["thinkingLevel"],
  ): Promise<snapshotTypes.TaskView> {
    return this.exclusive(actions.setModel(this, taskId, model, thinkingLevel ?? undefined));
  }

  sendNote(input: snapshotTypes.SendNoteInput): Promise<snapshotTypes.NoteDelivery> {
    return this.exclusive(actions.sendNote(this, input));
  }

  sendMessage(taskId: string, message: string): Promise<snapshotTypes.TaskView> {
    return this.exclusive(actions.sendMessage(this, taskId, message));
  }

  stop(taskId: string): Promise<snapshotTypes.TaskView> {
    return this.exclusive(actions.stop(this, taskId));
  }

  rerun(taskId: string, extra = ""): Promise<snapshotTypes.TaskView> {
    return this.exclusive(actions.rerun(this, taskId, extra));
  }

  setMaxConcurrentThreads(value: number): Promise<number> {
    return this.exclusive(actions.setMaxConcurrent(this, value));
  }

  replan(input: snapshotTypes.ReplanInput): Promise<snapshotTypes.ReplanResult> {
    return replan(this, input).then((result) => {
      this.telemetry.replanned(input, result);
      return result;
    });
  }

  handoff(input: handoffTypes.HandoffInput): Promise<handoffTypes.HandoffResult> {
    return this.exclusive(handoffs.write(this, input));
  }

  searchReports(query: string, limit = 10): Promise<snapshotTypes.ReportHit[]> {
    return this.exclusive(
      Effect.sync(() => store.searchReports(this.database, this.options.project, query, limit)),
    );
  }

  dispose(): Promise<void> {
    const poller = this.poller;
    this.poller = undefined;
    this.telemetry.close();
    const self = this;
    return Effect.runPromise(
      Effect.gen(function* () {
        if (poller !== undefined) yield* Fiber.interrupt(poller);
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

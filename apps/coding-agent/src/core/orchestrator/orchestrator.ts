import type { AgentMessage } from "@msa/agent-core";
import { Effect, Fiber } from "effect";

import { actions } from "./actions.ts";
import { replan, undoReplan } from "./replan.ts";
import { type Runtime, nowMillis } from "./runtime.ts";
import { scheduling } from "./schedule.ts";
import { settling } from "./settle.ts";
import {
  snapshots,
  type CreateTaskInput,
  type NoteDelivery,
  type OrchestratorSnapshot,
  type ReplanInput,
  type ReplanResult,
  type ReplanUndoResult,
  type ReportHit,
  type SendNoteInput,
  type TaskView,
} from "./snapshot.ts";
import { store } from "./store.ts";
import { TranscriptCache } from "./transcripts.ts";
import type { OrchestratorOptions, WorkerSession } from "./worker.ts";
import type { WrapUp } from "./wrap-up.ts";

export type {
  CreateWorkerOptions,
  OrchestratorDefaults,
  OrchestratorOptions,
  OrchestratorReport,
  WorkerSession,
} from "./worker.ts";
export type {
  CreateTaskInput,
  NoteDelivery,
  ReplanInput,
  ReplanResult,
  ReplanUndoResult,
  SendNoteInput,
} from "./types.ts";
export {
  ORCHESTRATOR_TOOL_NAMES,
  createOrchestratorToolDefinitions,
  isOrchestratorTool,
} from "./tools.ts";

export const ORCHESTRATOR_REPORT_MESSAGE_TYPE = "msa.orchestrator.report";

const EMPTY: OrchestratorSnapshot = {
  tasks: [],
  sessions: [],
  rounds: [],
  replans: [],
  maxConcurrentSessions: 4,
};

export class Orchestrator implements Runtime {
  readonly database: ReturnType<typeof store.openDatabase>;
  readonly options: OrchestratorOptions;
  readonly workers = new Map<string, WorkerSession>();
  readonly runs = new Map<string, number>();
  readonly runStartedAt = new Map<string, number>();
  readonly wrapUps = new Map<string, WrapUp>();
  readonly listeners = new Set<() => void>();
  replanning = false;
  snapshot: OrchestratorSnapshot = EMPTY;
  maxConcurrentSessions: number;
  private readonly transcripts = new TranscriptCache();
  private queue: Promise<void> = Promise.resolve();
  private runCount = 0;
  private poller: Fiber.Fiber<never, never> | undefined;

  constructor(options: OrchestratorOptions) {
    this.options = options;
    this.database = store.openDatabase(options.databasePath);
    store.recoverRunning(this.database, options.project, Effect.runSync(nowMillis));
    this.maxConcurrentSessions =
      store.storedMaxConcurrent(this.database, options.project) ??
      options.defaults().maxConcurrentSessions;
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
      this.maxConcurrentSessions,
    );
    for (const listener of this.listeners) listener();
  }

  settle(sessionId: string, run: number, worker: WorkerSession, error: unknown): Promise<void> {
    return settling.settle(this, sessionId, run, worker, error);
  }

  afterTurn(sessionId: string, run: number, worker: WorkerSession): void {
    settling.afterTurn(this, sessionId, run, worker);
  }

  get tasks(): readonly TaskView[] {
    return this.snapshot.tasks;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  messages(id: string): readonly AgentMessage[] {
    const sessionFile = this.snapshot.sessions.find((session) => session.id === id)?.sessionFile;
    return this.transcripts.messages(id, this.workers, sessionFile ?? null);
  }

  progress(id: string): { startedAt: number | undefined; retrying: boolean } {
    return {
      startedAt: this.runs.has(id) ? this.runStartedAt.get(id) : undefined,
      retrying: this.workers.get(id)?.isRetrying ?? false,
    };
  }

  refresh(): Promise<void> {
    return this.exclusive(Effect.sync(() => this.publish()));
  }

  list(): Promise<TaskView[]> {
    return this.refresh().then(() => [...this.snapshot.tasks]);
  }

  read(id: string): Promise<TaskView> {
    return this.refresh().then(() => {
      const found = this.snapshot.tasks.find((task) => task.id === id);
      if (found === undefined) throw new Error(`Unknown task: ${id}`);
      return found;
    });
  }

  createTask(input: CreateTaskInput): Promise<TaskView> {
    return this.exclusive(actions.createTask(this, input));
  }

  addDependency(taskId: string, dependsOn: string): Promise<TaskView> {
    return this.exclusive(actions.addDependency(this, taskId, dependsOn));
  }

  removeDependency(taskId: string, dependsOn: string): Promise<TaskView> {
    return this.exclusive(actions.removeDependency(this, taskId, dependsOn));
  }

  setPriority(taskId: string, priority: number): Promise<TaskView> {
    return this.exclusive(actions.setPriority(this, taskId, priority));
  }

  setModel(
    taskId: string,
    model: string,
    thinkingLevel?: TaskView["thinkingLevel"],
  ): Promise<TaskView> {
    return this.exclusive(actions.setModel(this, taskId, model, thinkingLevel ?? undefined));
  }

  sendNote(input: SendNoteInput): Promise<NoteDelivery> {
    return this.exclusive(actions.sendNote(this, input));
  }

  sendMessage(taskId: string, message: string): Promise<TaskView> {
    return this.exclusive(actions.sendMessage(this, taskId, message));
  }

  stop(taskId: string): Promise<TaskView> {
    return this.exclusive(actions.stop(this, taskId));
  }

  rerun(taskId: string, extra = ""): Promise<TaskView> {
    return this.exclusive(actions.rerun(this, taskId, extra));
  }

  setMaxConcurrentSessions(value: number): Promise<number> {
    return this.exclusive(actions.setMaxConcurrent(this, value));
  }

  replan(input: ReplanInput): Promise<ReplanResult> {
    return replan(this, input);
  }

  undoReplan(): Promise<ReplanUndoResult> {
    return undoReplan(this);
  }

  searchReports(query: string, limit = 10): Promise<ReportHit[]> {
    return this.exclusive(
      Effect.sync(() => store.searchReports(this.database, this.options.project, query, limit)),
    );
  }

  dispose(): Promise<void> {
    const poller = this.poller;
    this.poller = undefined;
    const self = this;
    return Effect.runPromise(
      Effect.gen(function* () {
        if (poller !== undefined) yield* Fiber.interrupt(poller);
        self.runs.clear();
        for (const worker of self.workers.values()) {
          yield* Effect.tryPromise({
            try: () => worker.abort(),
            catch: () => undefined,
          });
          worker.dispose();
        }
        self.workers.clear();
        yield* Effect.sync(() => self.database.close());
      }),
    );
  }
}

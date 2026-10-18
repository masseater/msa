import type { Context, JsonValue } from "@msa/chord";
import { copyJson } from "@msa/chord/json";

import { promiseTry } from "../promise-try.ts";
import type { ContextRange } from "./context.ts";
import { SchedulerGraph } from "./scheduler-graph.ts";
import { endedError, erased, missingMigration } from "./scheduler-records.ts";
import {
  type AnyTaskRecord,
  type ErasedRunningTask,
  type Fit,
  type Invocation,
  MAX_TIMER_DELAY,
  type Resolution,
  type RunnableTaskRecord,
  type TaskSchedulerOptions,
  type Transaction,
  type AnyTask,
  type ConversationId,
  type RegistrySnapshot,
  type SettledTask,
  type TaskId,
} from "./scheduler-types.ts";
import { closedError, Waiters } from "./util.ts";

export type Wake = {
  readonly reconcile: () => void;
  readonly kick: () => void;
};

export type KeptContext = { range: ContextRange; idleSince: number | undefined };

export class SchedulerState {
  readonly options: TaskSchedulerOptions;
  readonly wake: Wake;
  readonly graph: SchedulerGraph;
  readonly contexts = new Map<ConversationId, KeptContext>();
  readonly invocations = new Map<TaskId, Invocation>();
  readonly taskWaiters = new Waiters<TaskId, SettledTask<JsonValue>>();
  readonly idleWaiters = new Waiters<ConversationId | undefined, void>();
  readonly failedMigrations = new Map<
    TaskId,
    { readonly task: AnyTask; readonly error: unknown }
  >();
  readonly abandoned = new Set<TaskId>();
  expiry: { readonly at: number; readonly timer: ReturnType<typeof setTimeout> } | undefined;
  reconcileScheduled = false;
  sweepScheduled = false;
  cascadePending = false;
  unsubscribeRegistry: () => void = () => {};
  enabled = false;
  closing = false;
  dirty = false;
  draining = false;

  constructor(options: TaskSchedulerOptions, wake: Wake) {
    this.options = options;
    this.wake = wake;
    this.graph = new SchedulerGraph({
      scheduleReconcile: () => wake.reconcile(),
      scheduleSweep: () => this.#scheduleSweep(),
    });
  }

  #scheduleSweep(): void {
    if (this.sweepScheduled || this.closing) return;
    this.sweepScheduled = true;
    this.options.session
      .readOnLine(() =>
        promiseTry(() => {
          this.sweepScheduled = false;
          this.graph.sweep();
        }),
      )
      .catch(() => {});
  }

  failSession(error: unknown): void {
    if (!this.closing) this.options.session.fail(error);
  }

  contextRetentionMs(): number {
    try {
      return this.options.settings().contextRetentionMs;
    } catch (error) {
      this.options.report(error);
      return 0;
    }
  }

  settleIdle(): void {
    const { graph } = this;
    for (const conversationId of this.idleWaiters.keys()) {
      if (graph.idle(conversationId)) this.idleWaiters.resolve(conversationId);
    }
    const now = this.options.now();
    const retention = this.contextRetentionMs();
    for (const [conversationId, kept] of this.contexts) {
      if (kept.idleSince !== undefined && now - kept.idleSince >= retention) {
        this.contexts.delete(conversationId);
      } else if (!graph.idle(conversationId)) {
        kept.idleSince = undefined;
      } else if (retention > 0) {
        kept.idleSince ??= now;
      } else {
        this.contexts.delete(conversationId);
      }
    }
    this.scheduleExpiry();
  }

  #nextExpiry(retention: number): number | undefined {
    let at: number | undefined;
    for (const kept of this.contexts.values()) {
      if (kept.idleSince !== undefined && (at === undefined || kept.idleSince + retention < at)) {
        at = kept.idleSince + retention;
      }
    }
    return at;
  }

  scheduleExpiry(): void {
    const at = this.#nextExpiry(this.contextRetentionMs());
    if (this.expiry !== undefined && this.expiry.at === at) return;
    if (this.expiry !== undefined) clearTimeout(this.expiry.timer);
    this.expiry = undefined;
    if (at === undefined || this.closing) return;
    const timer = setTimeout(
      () => {
        this.expiry = undefined;
        this.settleIdle();
      },
      Math.min(Math.max(0, at - this.options.now()), MAX_TIMER_DELAY),
    );
    const unref = (timer as { unref?: unknown }).unref;
    if (typeof unref !== "function") {
      clearTimeout(timer);
      return;
    }
    unref.call(timer);
    this.expiry = { at, timer };
  }

  seal(): void {
    this.closing = true;
    try {
      this.unsubscribeRegistry();
    } catch (error) {
      this.options.report(error);
    }
    const error = closedError(this.options.session);
    this.taskWaiters.rejectAll(error);
    this.idleWaiters.rejectAll(error);
    this.contexts.clear();
    if (this.expiry !== undefined) clearTimeout(this.expiry.timer);
    this.expiry = undefined;
  }

  fit(record: AnyTaskRecord, task: AnyTask | undefined): Fit {
    if (task === undefined) return { reason: "missing_task" };
    const version = task.definition.version;
    if (version === record.version) return { task, migrates: false };
    if (version < record.version) return { reason: "task_too_old" };
    const failed = this.failedMigrations.get(record.id);
    if (failed?.task === task) return { reason: "migration_failed", error: failed.error };
    return { task, migrates: true };
  }

  resolve(record: RunnableTaskRecord, snapshot: RegistrySnapshot): Resolution {
    const fit = this.fit(record, snapshot.task(record.kind));
    if ("reason" in fit) return { kind: "blocked", reason: fit.reason };
    if (!fit.migrates) return { kind: "ready", task: fit.task, record };
    const definition = erased(fit.task);
    try {
      if (definition.migrate === undefined) throw missingMigration(record, definition);
      const migrated = definition.migrate(record.input, record.state.checkpoint, record.version);
      const state = { ...record.state, checkpoint: copyJson(migrated.checkpoint) };
      const migratedRecord = {
        ...record,
        version: definition.version,
        input: copyJson(migrated.input),
        state,
      };
      return { kind: "ready", task: fit.task, record: migratedRecord as RunnableTaskRecord };
    } catch (error) {
      this.failedMigrations.set(record.id, { task: fit.task, error });
      this.options.report(error);
      return { kind: "blocked", reason: "migration_failed" };
    }
  }

  end(invocation: Invocation): void {
    if (invocation.ended) return;
    invocation.ended = true;
    if (this.invocations.get(invocation.taskId) === invocation) {
      this.invocations.delete(invocation.taskId);
      if (this.graph.live.has(invocation.taskId)) this.graph.runnable.add(invocation.taskId);
    }
    for (const watch of invocation.watches) void watch.stop();
    invocation.controller.abort(endedError(invocation));
  }

  read<T>(invocation: Invocation, read: () => Promise<T>): Promise<T> {
    return promiseTry(() => {
      if (invocation.ended) throw endedError(invocation);
      return read();
    });
  }

  gated<T>(
    invocation: Invocation,
    change: (tx: Transaction, current: ErasedRunningTask) => T | Promise<T>,
    context: Context,
  ): Promise<T> {
    if (invocation.ended) return Promise.reject(endedError(invocation));
    return this.options.session.commitWith(
      (tx) => promiseTry(() => change(tx, this.#runningFor(invocation))),
      context,
      { conversationId: invocation.conversationId, taskId: invocation.taskId },
    );
  }

  #runningFor(invocation: Invocation): ErasedRunningTask {
    if (invocation.ended) throw endedError(invocation);
    if (this.closing) throw closedError(this.options.session);
    const found = this.graph.live.get(invocation.taskId);
    if (found === undefined) throw new Error(`Task ${invocation.taskId} is terminal`);
    if (found.state.status !== "running")
      throw new Error(`Task ${invocation.taskId} is ${found.state.status}`);
    const current = found as ErasedRunningTask;
    if (invocation.mode === "run" && current.abortRequested) {
      throw new Error(`Task ${invocation.taskId} has a durable abort mark`);
    }
    return current;
  }

  waitForIdle(conversationId: ConversationId | undefined, context: Context): Promise<void> {
    if (this.closing) return Promise.reject(closedError(this.options.session));
    if (this.graph.idle(conversationId)) return Promise.resolve();
    this.wake.reconcile();
    return this.idleWaiters.add(conversationId, context);
  }
}

import type { Context, JsonValue } from "@msa/chord";
import { copyJson } from "@msa/chord/json";

import promiseTryModule from "../promise-try.ts";
import unrefTimer from "../unref-timer.ts";
import SchedulerGraph from "./scheduler-graph.ts";
import schedulerRecords from "./scheduler-records.ts";
import type schedulerStateTypes from "./scheduler-state.types.ts";
import schedulerTypes from "./scheduler-types.ts";
import type schedulerTypesModule from "./scheduler-types.types.ts";
import util from "./util.ts";

const { startUnrefTimer } = unrefTimer;

const { Waiters, closedError } = util;

const { promiseTry } = promiseTryModule;
const { MAX_TIMER_DELAY } = schedulerTypes;
const { endedError, erased, missingMigration } = schedulerRecords;

export default class SchedulerState {
  readonly options: schedulerTypesModule.TaskSchedulerOptions;
  readonly wake: schedulerStateTypes.Wake;
  readonly graph: schedulerStateTypes.SchedulerGraph;
  readonly contexts = new Map<
    schedulerTypesModule.ConversationId,
    schedulerStateTypes.KeptContext
  >();
  readonly invocations = new Map<schedulerTypesModule.TaskId, schedulerTypesModule.Invocation>();
  readonly taskWaiters = new Waiters<
    schedulerTypesModule.TaskId,
    schedulerTypesModule.SettledTask<JsonValue>
  >();
  readonly idleWaiters = new Waiters<schedulerTypesModule.ConversationId | undefined, void>();
  readonly failedMigrations = new Map<
    schedulerTypesModule.TaskId,
    { readonly task: schedulerTypesModule.AnyTask; readonly error: unknown }
  >();
  readonly abandoned = new Set<schedulerTypesModule.TaskId>();
  expiry:
    | { readonly at: number; readonly timer: NonNullable<ReturnType<typeof startUnrefTimer>> }
    | undefined;
  reconcileScheduled = false;
  sweepScheduled = false;
  cascadePending = false;
  unsubscribeRegistry: () => void = () => {};
  enabled = false;
  closing = false;
  dirty = false;
  draining = false;

  constructor(options: schedulerTypesModule.TaskSchedulerOptions, wake: schedulerStateTypes.Wake) {
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
    this.expiry?.timer.cancel();
    this.expiry = undefined;
    if (at === undefined || this.closing) return;
    const timer = startUnrefTimer(
      () => {
        this.expiry = undefined;
        this.settleIdle();
      },
      Math.min(Math.max(0, at - this.options.now()), MAX_TIMER_DELAY),
    );
    if (timer === undefined) return;
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
    this.expiry?.timer.cancel();
    this.expiry = undefined;
  }

  fit(
    record: schedulerTypesModule.AnyTaskRecord,
    task: schedulerTypesModule.AnyTask | undefined,
  ): schedulerTypesModule.Fit {
    if (task === undefined) return { reason: "missing_task" };
    const version = task.definition.version;
    if (version === record.version) return { migrates: false, task };
    if (version < record.version) return { reason: "task_too_old" };
    const failed = this.failedMigrations.get(record.id);
    if (failed?.task === task) return { error: failed.error, reason: "migration_failed" };
    return { migrates: true, task };
  }

  resolve(
    record: schedulerTypesModule.RunnableTaskRecord,
    snapshot: schedulerTypesModule.RegistrySnapshot,
  ): schedulerTypesModule.Resolution {
    const fit = this.fit(record, snapshot.task(record.kind));
    if ("reason" in fit) return { kind: "blocked", reason: fit.reason };
    if (!fit.migrates) return { kind: "ready", record, task: fit.task };
    const definition = erased(fit.task);
    try {
      if (definition.migrate === undefined) throw missingMigration(record, definition);
      const migrated = definition.migrate(record.input, record.state.checkpoint, record.version);
      const state = { ...record.state, checkpoint: copyJson(migrated.checkpoint) };
      const migratedRecord = {
        ...record,
        input: copyJson(migrated.input),
        state,
        version: definition.version,
      };
      return {
        kind: "ready",
        record: migratedRecord as schedulerTypesModule.RunnableTaskRecord,
        task: fit.task,
      };
    } catch (error) {
      this.failedMigrations.set(record.id, { error, task: fit.task });
      this.options.report(error);
      return { kind: "blocked", reason: "migration_failed" };
    }
  }

  end(invocation: schedulerTypesModule.Invocation): void {
    if (invocation.ended) return;
    invocation.ended = true;
    if (this.invocations.get(invocation.taskId) === invocation) {
      this.invocations.delete(invocation.taskId);
      if (this.graph.live.has(invocation.taskId)) this.graph.runnable.add(invocation.taskId);
    }
    for (const watch of invocation.watches) void watch.stop();
    invocation.controller.abort(endedError(invocation));
  }

  read<T>(invocation: schedulerTypesModule.Invocation, read: () => Promise<T>): Promise<T> {
    return promiseTry(() => {
      if (invocation.ended) throw endedError(invocation);
      return read();
    });
  }

  gated<T>(
    invocation: schedulerTypesModule.Invocation,
    change: (
      tx: schedulerTypesModule.Transaction,
      current: schedulerTypesModule.ErasedRunningTask,
    ) => T | Promise<T>,
    context: Context,
  ): Promise<T> {
    if (invocation.ended) return Promise.reject(endedError(invocation));
    return this.options.session.commitWith(
      (tx) => promiseTry(() => change(tx, this.#runningFor(invocation))),
      context,
      { conversationId: invocation.conversationId, taskId: invocation.taskId },
    );
  }

  #runningFor(invocation: schedulerTypesModule.Invocation): schedulerTypesModule.ErasedRunningTask {
    if (invocation.ended) throw endedError(invocation);
    if (this.closing) throw closedError(this.options.session);
    const found = this.graph.live.get(invocation.taskId);
    if (found === undefined) throw new Error(`Task ${invocation.taskId} is terminal`);
    if (found.state.status !== "running")
      throw new Error(`Task ${invocation.taskId} is ${found.state.status}`);
    const current = found as schedulerTypesModule.ErasedRunningTask;
    if (invocation.mode === "run" && current.abortRequested) {
      throw new Error(`Task ${invocation.taskId} has a durable abort mark`);
    }
    return current;
  }

  waitForIdle(
    conversationId: schedulerTypesModule.ConversationId | undefined,
    context: Context,
  ): Promise<void> {
    if (this.closing) return Promise.reject(closedError(this.options.session));
    if (this.graph.idle(conversationId)) return Promise.resolve();
    this.wake.reconcile();
    return this.idleWaiters.add(conversationId, context);
  }
}

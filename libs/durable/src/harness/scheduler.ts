import type { Models } from "@msa/ai";
import { type Context, copyJson, type JsonValue } from "@msa/chord";
import { awaitWithContext, withAbortSignal } from "@msa/chord/context";

import type { ExecutionEnv } from "../env/index.ts";
import { errorMessage } from "../errors.ts";
import { promiseTry } from "../promise-try.ts";
import type { SessionImpl } from "../session/session.ts";
import type { Transaction } from "../session/transaction.ts";
import type {
  CommitPublication,
  ConversationId,
  DocumentWatch,
  EntryId,
  EntryRecord,
  HookRunner,
  JsonObject,
  NextTaskState,
  RunningTask,
  Storage,
  TaskDefinition,
  TaskId,
  TaskOutcome,
  TaskRecord,
  TaskRuntime,
  TaskState,
} from "../types.ts";
import { agentHooks } from "./agent.ts";
import { type ContextRange, readContextFrom } from "./context.ts";
import type {
  Agent,
  AnyTask,
  ConversationHandle,
  HarnessInspection,
  RegistryReader,
  RegistrySnapshot,
  Settings,
  SettledTask,
  TaskInspection,
} from "./types.ts";
import { closedError, scanAll, Waiters } from "./util.ts";

type AnyTaskRecord = TaskRecord<JsonValue, JsonValue, JsonValue>;
type RunnableTaskRecord = Extract<
  AnyTaskRecord,
  { readonly state: { readonly status: "pending" | "running" | "waiting" } }
>;
type Checkpoint = { readonly phase: string };
type ErasedDefinition = TaskDefinition<JsonValue, Checkpoint, JsonValue, object>;
type ErasedRuntime = TaskRuntime<JsonValue, Checkpoint, JsonValue, object>;
type ErasedRunningTask = RunningTask<JsonValue, Checkpoint, JsonValue>;

const SCAN_PAGE_SIZE = 256;
const MAX_TIMER_DELAY = 2_147_483_647;
const LIVE_STATUSES = ["pending", "running", "waiting", "completing"] as const;

type BlockedReason = "missing_task" | "task_too_old" | "migration_failed";

type Resolution =
  | { readonly kind: "ready"; readonly task: AnyTask; readonly record: RunnableTaskRecord }
  | { readonly kind: "blocked"; readonly reason: BlockedReason };

type Fit =
  | { readonly task: AnyTask; readonly migrates: boolean }
  | { readonly reason: BlockedReason; readonly error?: unknown };

type Invocation = {
  readonly taskId: TaskId;
  readonly conversationId: ConversationId;
  readonly mode: "run" | "abort";
  readonly controller: AbortController;
  readonly context: Context;
  readonly watches: Set<DocumentWatch<JsonObject>>;
  ended: boolean;
  readonly done: Promise<void>;
  readonly finish: () => void;
};

type Phase = {
  readonly snapshot: () => RegistrySnapshot;
  readonly task: () => AnyTask;
  agent: Promise<Agent> | undefined;
};

type Reservation = {
  readonly invocation: Invocation;
  readonly task: AnyTask;
  readonly snapshot: RegistrySnapshot;
};

type ReportedTask = { readonly task: AnyTask | undefined } | undefined;

type PhaseResult = {
  readonly checkpoint: Checkpoint;
  readonly failure?: { readonly error: unknown };
};

type Decision = boolean | { readonly fault: unknown };

export type SchedulerOutcome = Extract<
  TaskOutcome<JsonValue>,
  { readonly status: "faulted" | "orphaned" }
>;

export type InvocationBinding = { readonly signal: AbortSignal; check(): void };

type TaskNode = Pick<AnyTaskRecord, "conversationId" | "owner" | "background">;

type Up = { readonly task: TaskId } | { readonly conversation: ConversationId };

type Step =
  | { readonly task: TaskId; readonly node: TaskNode }
  | { readonly conversation: ConversationId }
  | { readonly unknown: true };

type Overlay = {
  readonly tasks: ReadonlyMap<TaskId, AnyTaskRecord>;
  readonly edges: ReadonlyMap<ConversationId, TaskId | null>;
  links?: ReadonlyMap<Node, ReadonlySet<Node>>;
};

type Node = TaskId | `c${number}`;

function conversationNode(id: ConversationId): Node {
  return `c${id}`;
}

function conversationOf(node: `c${number}`): ConversationId {
  return Number(node.slice(1)) as ConversationId;
}

function parentNode(node: TaskNode): Node {
  return node.owner ?? conversationNode(node.conversationId);
}

type Scope = { readonly conversation: ConversationId } | { readonly roots: true };

export type TaskSchedulerOptions = {
  readonly session: SessionImpl;
  readonly storage: Storage;
  readonly registry: RegistryReader;
  readonly models: Models;
  readonly agent: (
    conversationId: ConversationId,
    snapshot: RegistrySnapshot,
    context: Context,
  ) => Promise<Agent>;
  readonly settings: () => Settings;
  readonly env: (
    conversationId: ConversationId,
    context: Context,
  ) => Promise<ExecutionEnv | undefined>;
  readonly now: () => number;
  readonly report: (error: unknown) => void;
  readonly settleOutcome: (
    tx: Transaction,
    record: AnyTaskRecord,
    outcome: SchedulerOutcome,
  ) => Promise<void>;
  readonly withdrawInputs: (tx: Transaction, conversationId: ConversationId) => Promise<void>;
  readonly conversation: (
    id: ConversationId,
    binding: InvocationBinding,
    context: Context,
  ) => Promise<ConversationHandle | undefined>;
  readonly context: Context;
};

export class TaskScheduler {
  readonly #session: SessionImpl;
  readonly #storage: Storage;
  readonly #registry: RegistryReader;
  readonly #models: Models;
  readonly #agent: TaskSchedulerOptions["agent"];
  readonly #settings: TaskSchedulerOptions["settings"];
  readonly #env: TaskSchedulerOptions["env"];
  readonly #now: () => number;
  readonly #report: (error: unknown) => void;
  readonly #settleOutcome: TaskSchedulerOptions["settleOutcome"];
  readonly #withdrawInputs: TaskSchedulerOptions["withdrawInputs"];
  readonly #conversation: TaskSchedulerOptions["conversation"];
  readonly #context: Context;
  readonly #live = new Map<TaskId, AnyTaskRecord>();
  readonly #contexts = new Map<
    ConversationId,
    { range: ContextRange; idleSince: number | undefined }
  >();
  #expiry: { readonly at: number; readonly timer: ReturnType<typeof setTimeout> } | undefined;
  readonly #invocations = new Map<TaskId, Invocation>();
  readonly #taskWaiters = new Waiters<TaskId, SettledTask<JsonValue>>();
  readonly #idleWaiters = new Waiters<ConversationId | undefined, void>();
  readonly #failedMigrations = new Map<
    TaskId,
    { readonly task: AnyTask; readonly error: unknown }
  >();
  readonly #edges = new Map<ConversationId, TaskId | null>();
  readonly #settled = new Map<TaskId, TaskNode>();
  readonly #dropQueue = new Set<Node>();
  readonly #below = new Map<Node, Set<Node>>();
  readonly #roots = new Set<ConversationId>();
  readonly #unloaded = new Set<TaskId>();
  readonly #intent = new Set<TaskId>();
  readonly #runnable = new Set<TaskId>();
  readonly #finalizeChecks = new Set<TaskId>();
  readonly #waiters = new Map<TaskId, Set<TaskId>>();
  readonly #failFastChecks = new Set<TaskId>();
  readonly #abandoned = new Set<TaskId>();
  #reconcileScheduled = false;
  #sweepScheduled = false;
  #cascadePending = false;
  #unsubscribeRegistry: () => void = () => {};
  #enabled = false;
  #closing = false;
  #dirty = false;
  #draining = false;

  constructor(options: TaskSchedulerOptions) {
    this.#session = options.session;
    this.#storage = options.storage;
    this.#registry = options.registry;
    this.#models = options.models;
    this.#agent = options.agent;
    this.#settings = options.settings;
    this.#env = options.env;
    this.#now = options.now;
    this.#report = options.report;
    this.#settleOutcome = options.settleOutcome;
    this.#withdrawInputs = options.withdrawInputs;
    this.#conversation = options.conversation;
    this.#context = options.context;
  }

  async open(context: Context): Promise<void> {
    this.#session.observeCommits((publication) => this.#observe(publication));
    this.#session.subscribeClose(() => this.#seal());
    this.#unsubscribeRegistry = this.#registry.subscribe(() => this.#kick());
    await this.#session.commitWith(async (tx) => {
      const scans = [];
      for await (const status of LIVE_STATUSES) {
        scans.push(await scanAll((cursor) => tx.scanTasks({ status }, SCAN_PAGE_SIZE, cursor)));
      }
      for (const records of scans) {
        for (const record of records) {
          this.#track(undefined, record);
          if (record.abandonOnRestart === true) this.#abandoned.add(record.id);
          if (record.state.status === "running") {
            tx.setTask(
              withState(record, { status: "pending", checkpoint: record.state.checkpoint }),
            );
          }
          if (record.state.status === "waiting" && record.state.policy === "failFast") {
            this.#failFastChecks.add(record.id);
          }
        }
      }
    }, context);
    this.#cascadePending = true;
    this.#scheduleReconcile();
  }

  resume(): void {
    this.#enabled = true;
    this.#kick();
  }

  async join(): Promise<void> {
    for (const invocation of this.#invocations.values()) invocation.controller.abort();
    await Promise.allSettled([...this.#invocations.values()].map((invocation) => invocation.done));
  }

  async abort(id: TaskId, context: Context, keepRestart = false): Promise<"marked" | "terminal"> {
    const marked = await this.#session.commitWith(async (tx) => {
      const current = await tx.task(id);
      if (current === undefined) throw new Error(`Task ${id} does not exist`);
      if (current.state.status === "terminal") return { result: "terminal" as const };
      const invocation = this.#invocations.get(id);
      if (keepRestart && current.abortReason === "restart") return { result: "marked" as const };
      if (invocation === undefined && current.state.status !== "completing") {
        await this.#loadScopes(false);
        if (!this.#hasOwnedLive(id)) {
          const resolution = this.#resolve(
            current as RunnableTaskRecord,
            this.#registry.snapshot(),
          );
          if (resolution.kind === "blocked") {
            await this.#terminate(tx, current, { status: "orphaned", reason: resolution.reason });
            return { result: "marked" as const };
          }
        }
      }
      if (!current.abortRequested || current.abortReason !== undefined)
        tx.setTask(withAbortMark(current));
      return {
        result: "marked" as const,
        run: invocation?.mode === "run" ? invocation : undefined,
      };
    }, context);
    if (marked.run !== undefined) {
      await awaitWithContext(Promise.race([marked.run.done, this.#session.failed]), context);
    }
    return marked.result;
  }

  async waitForTask(id: TaskId, context: Context): Promise<SettledTask<JsonValue>> {
    const found = await this.#session.readOnLine(async () => {
      if (this.#closing) throw closedError(this.#session);
      if (this.#live.has(id)) return { promise: this.#taskWaiters.add(id, context) };
      const record = await this.#storage.task(id, context);
      if (record === undefined) throw new Error(`Task ${id} does not exist`);
      return { promise: Promise.resolve(record as SettledTask<JsonValue>) };
    });
    return found.promise;
  }

  waitForIdle(conversationId: ConversationId | undefined, context: Context): Promise<void> {
    if (this.#closing) return Promise.reject(closedError(this.#session));
    if (this.#idle(conversationId)) return Promise.resolve();
    this.#scheduleReconcile();
    return this.#idleWaiters.add(conversationId, context);
  }

  async abortConversation(
    conversationId: ConversationId,
    background: boolean,
    context: Context,
  ): Promise<void> {
    const reached = await this.#session.commitWith(async (tx) => {
      const queued = await this.#loadScopes(true);
      const scope = { conversation: conversationId };
      const reachedIds: TaskId[] = [];
      const walk = this.#walkDown(conversationNode(conversationId), {
        crossBackground: background,
      });
      for (const { node, live } of walk) {
        if (live === undefined || (node.background && !background)) continue;
        reachedIds.push(live.id);
        if (!live.abortRequested || live.abortReason !== undefined) tx.setTask(withAbortMark(live));
      }
      for await (const id of queued) {
        if (this.#inScope({ conversation: id }, scope, background) === true)
          await this.#withdrawInputs(tx, id);
      }
      return reachedIds;
    }, context);
    if (background) for await (const id of reached) await this.waitForTask(id, context);
    await this.waitForIdle(conversationId, context);
  }

  #observe(publication: CommitPublication): void {
    const updated: AnyTaskRecord[] = [];
    const failed: TaskId[] = [];
    let changed = false;
    for (const change of publication.changes) {
      if (change.type === "conversation" && !this.#edges.has(change.value.id)) {
        this.#setEdge(change.value.id, change.value.owner?.taskId ?? null);
      }
    }
    for (const change of publication.changes) {
      if (change.type !== "task") continue;
      changed = true;
      const record = change.value;
      const previous = this.#live.get(record.id);
      if (failedOutcome(record) && (previous === undefined || !failedOutcome(previous)))
        failed.push(record.id);
      this.#track(previous, record);
      if (record.state.status === "terminal") {
        this.#failedMigrations.delete(record.id);
        this.#failFastChecks.delete(record.id);
        this.#taskWaiters.resolve(record.id, record as SettledTask<JsonValue>);
        this.#scheduleReconcile();
        continue;
      }
      if (record.abortRequested && previous?.abortRequested !== true) {
        this.#cascadePending = true;
        const invocation = this.#invocations.get(record.id);
        if (invocation?.mode === "run") invocation.controller.abort();
      }
      if (previous?.abortReason !== undefined && record.abortReason === undefined)
        this.#cascadePending = true;
      const status = record.state.status;
      if (status === "completing" && previous?.state.status !== "completing") {
        if (cancellationIntent(record)) this.#cascadePending = true;
        this.#scheduleReconcile();
      }
      if (
        status === "waiting" &&
        record.state.policy === "failFast" &&
        previous?.state.status !== "waiting"
      ) {
        this.#failFastChecks.add(record.id);
        this.#scheduleReconcile();
      }
      if (previous === undefined) updated.push(record);
    }
    for (const id of failed) {
      for (const waiter of this.#waiters.get(id) ?? []) {
        const state = this.#live.get(waiter)?.state;
        if (state?.status === "waiting" && state.policy === "failFast") {
          this.#failFastChecks.add(waiter);
          this.#scheduleReconcile();
        }
      }
    }
    for (const change of publication.changes) {
      if (
        change.type !== "submission" ||
        change.value.status !== "queued" ||
        change.value.type !== "input"
      )
        continue;
      if (this.#intent.size === 0) continue;
      const conversation = change.value.conversationId;
      if (!this.#known(conversationNode(conversation)) || this.#belowCancelled({ conversation })) {
        this.#cascadePending = true;
      }
    }
    for (const record of updated) {
      if (this.#unloaded.has(record.id)) this.#scheduleReconcile();
      else if (
        !record.background &&
        !record.abortRequested &&
        this.#belowCancelled(parentOf(record))
      ) {
        this.#cascadePending = true;
      }
    }
    if (this.#cascadePending) this.#scheduleReconcile();
    this.#sweep();
    if (!changed) return;
    this.#settleIdle();
    this.#kick();
  }

  #contextRetentionMs(): number {
    try {
      return this.#settings().contextRetentionMs;
    } catch (error) {
      this.#report(error);
      return 0;
    }
  }

  #settleIdle(): void {
    for (const conversationId of this.#idleWaiters.keys()) {
      if (this.#idle(conversationId)) this.#idleWaiters.resolve(conversationId);
    }
    const now = this.#now();
    const retention = this.#contextRetentionMs();
    for (const [conversationId, kept] of this.#contexts) {
      if (kept.idleSince !== undefined && now - kept.idleSince >= retention) {
        this.#contexts.delete(conversationId);
      } else if (!this.#idle(conversationId)) {
        kept.idleSince = undefined;
      } else if (retention > 0) {
        kept.idleSince ??= now;
      } else {
        this.#contexts.delete(conversationId);
      }
    }
    this.#scheduleExpiry();
  }

  #scheduleExpiry(): void {
    const retention = this.#contextRetentionMs();
    let at: number | undefined;
    for (const kept of this.#contexts.values()) {
      if (kept.idleSince !== undefined && (at === undefined || kept.idleSince + retention < at)) {
        at = kept.idleSince + retention;
      }
    }
    if (this.#expiry !== undefined && this.#expiry.at === at) return;
    if (this.#expiry !== undefined) clearTimeout(this.#expiry.timer);
    this.#expiry = undefined;
    if (at === undefined || this.#closing) return;
    const timer = setTimeout(
      () => {
        this.#expiry = undefined;
        this.#settleIdle();
      },
      Math.min(Math.max(0, at - this.#now()), MAX_TIMER_DELAY),
    );
    const unref = (timer as { unref?: unknown }).unref;
    if (typeof unref !== "function") {
      clearTimeout(timer);
      return;
    }
    unref.call(timer);
    this.#expiry = { at, timer };
  }

  #scheduleReconcile(): void {
    if (this.#reconcileScheduled || this.#closing) return;
    this.#reconcileScheduled = true;
    queueMicrotask(() => void this.#reconcile());
  }

  async #reconcile(): Promise<void> {
    this.#reconcileScheduled = false;
    const cascade = this.#cascadePending;
    this.#cascadePending = false;
    const checks = [...this.#failFastChecks];
    this.#failFastChecks.clear();
    try {
      await this.#session.commitWith(async (tx) => {
        if (this.#closing) return;
        const queued = await this.#loadScopes(cascade);
        const marks = new Map<
          TaskId,
          { readonly record: AnyTaskRecord; readonly reason: "restart" | undefined }
        >();
        const mark = (record: AnyTaskRecord, reason: "restart" | undefined): void => {
          const staged = marks.get(record.id);
          if (staged !== undefined && staged.reason === undefined) return;
          if (record.abortRequested && (record.abortReason === undefined || reason !== undefined))
            return;
          marks.set(record.id, { record, reason });
        };
        for (const id of this.#intent) {
          const owner = this.#live.get(id)!;
          const restart = owner.abortReason === "restart" && !failedOutcome(owner);
          for (const { node, live } of this.#walkDown(id, {
            enter: (below) => !this.#intent.has(below),
          })) {
            if (live !== undefined && !node.background) mark(live, restart ? "restart" : undefined);
          }
        }
        for await (const id of checks) {
          const waiter = this.#live.get(id);
          if (waiter?.state.status !== "waiting" || !(await this.#anyFailed(waiter.state.on)))
            continue;
          for (const member of waiter.state.on) {
            const record = this.#live.get(member);
            if (record !== undefined && !failedOutcome(record)) mark(record, undefined);
          }
        }
        for (const { record, reason } of marks.values()) tx.setTask(withAbortMark(record, reason));
        for (const id of queued)
          if (this.#belowCancelled({ conversation: id })) await this.#withdrawInputs(tx, id);
        await this.#finalize(tx);
      }, this.#context);
    } catch (error) {
      this.#failSession(error);
    }
    this.#settleIdle();
  }

  async #anyFailed(ids: readonly TaskId[]): Promise<boolean> {
    for await (const id of ids) {
      const record = this.#live.get(id) ?? (await this.#storage.task(id, this.#context));
      if (record !== undefined && failedOutcome(record)) return true;
    }
    return false;
  }

  async #finalize(tx: Transaction): Promise<void> {
    const round = [...this.#finalizeChecks];
    this.#finalizeChecks.clear();
    await this.#finalizeRound(tx, round, new Set<TaskId>(), overlayOf(tx));
  }

  async #finalizeRound(
    tx: Transaction,
    round: readonly TaskId[],
    done: Set<TaskId>,
    overlay: Overlay,
  ): Promise<void> {
    if (round.length === 0) return;
    const next = new Set<TaskId>();
    for await (const id of round) {
      const record = overlay.tasks.get(id) ?? this.#live.get(id);
      if (record?.state.status !== "completing" || done.has(id)) continue;
      if (this.#hasOwnedLive(id, overlay, done)) continue;
      const outcome = record.state.outcome;
      const terminal = withState(record, { status: "terminal", outcome });
      tx.setTask(terminal);
      (overlay.tasks as Map<TaskId, AnyTaskRecord>).set(id, terminal);
      done.add(id);
      if (outcome.status === "faulted" || outcome.status === "orphaned") {
        await this.#settleOutcome(tx, record, outcome);
      }
      const above = this.#nearestLiveAbove(record, overlay);
      if (above?.state.status === "completing") next.add(above.id);
    }
    await this.#finalizeRound(tx, [...next], done, overlay);
  }

  async #loadScopes(queued: boolean): Promise<ConversationId[]> {
    for await (const id of [...this.#unloaded]) {
      if (this.#unloaded.has(id)) await this.#loadChain({ task: id });
    }
    if (!queued) return [];
    const submissions = await scanAll((cursor) =>
      this.#storage.scanSubmissions({ status: "queued" }, SCAN_PAGE_SIZE, cursor, this.#context),
    );
    const inputs = submissions.filter((submission) => submission.type === "input");
    const conversations = [...new Set(inputs.map((submission) => submission.conversationId))];
    for await (const id of conversations) await this.#loadChain({ conversation: id });
    return conversations;
  }

  async #loadChain(start: Up, overlay?: Overlay): Promise<void> {
    const passed: TaskId[] = [];
    if (!(await this.#loadStep(start, overlay, passed))) return;
    for (const id of passed) this.#unloaded.delete(id);
  }

  async #loadStep(
    at: Up | undefined,
    overlay: Overlay | undefined,
    passed: TaskId[],
  ): Promise<boolean> {
    if (at === undefined) return true;
    if (!("task" in at)) {
      let edge = this.#edge(at.conversation, overlay);
      if (edge === undefined) {
        const record = await this.#storage.conversation(at.conversation, this.#context);
        edge = record?.owner?.taskId ?? null;
        this.#setEdge(at.conversation, edge);
        this.#scheduleReconcile();
      }
      return this.#loadStep(edge === null ? undefined : { task: edge }, overlay, passed);
    }
    const id: TaskId = at.task;
    let node: TaskNode | undefined = this.#live.get(id) ?? this.#settled.get(id);
    if (node === undefined && overlay?.tasks.has(id) === true) return true;
    if (node !== undefined && !this.#unloaded.has(id)) return true;
    if (node === undefined) {
      const record = await this.#storage.task(id, this.#context);
      if (record === undefined) return false;
      node = nodeOf(record);
      if (record.state.status === "terminal") this.#settle(id, node);
      this.#scheduleReconcile();
    }
    passed.push(id);
    return this.#loadStep(parentOf(node), overlay, passed);
  }

  #setEdge(conversationId: ConversationId, owner: TaskId | null): void {
    this.#edges.set(conversationId, owner);
    this.#relist(conversationNode(conversationId));
    this.#dropIfUnneeded(conversationNode(conversationId));
  }

  #settle(id: TaskId, node: TaskNode): void {
    this.#settled.set(id, node);
    this.#unloaded.add(id);
    this.#relist(id);
    this.#dropIfUnneeded(id);
  }

  #dropIfUnneeded(node: Node): void {
    if (typeof node !== "string" && this.#live.has(node)) return;
    if (this.#below.has(node)) return;
    this.#dropQueue.add(node);
    this.#scheduleSweep();
  }

  #scheduleSweep(): void {
    if (this.#sweepScheduled || this.#closing) return;
    this.#sweepScheduled = true;
    this.#session
      .readOnLine(() =>
        promiseTry(() => {
          this.#sweepScheduled = false;
          this.#sweep();
        }),
      )
      .catch(() => {});
  }

  #sweep(): void {
    for (const node of this.#dropQueue) {
      if (this.#below.has(node)) continue;
      if (typeof node === "string") {
        this.#edges.delete(conversationOf(node));
        this.#roots.delete(conversationOf(node));
      } else if (!this.#live.has(node)) {
        this.#settled.delete(node);
        this.#unloaded.delete(node);
      }
    }
    this.#dropQueue.clear();
  }

  #track(previous: AnyTaskRecord | undefined, record: AnyTaskRecord): void {
    const id = record.id;
    if (previous?.state.status === "waiting")
      for (const on of previous.state.on) deleteFrom(this.#waiters, on, id);
    if (record.state.status === "terminal") {
      const node = nodeOf(record);
      this.#live.delete(id);
      this.#intent.delete(id);
      this.#runnable.delete(id);
      this.#finalizeChecks.delete(id);
      this.#settled.set(id, node);
      this.#release(node);
      for (const waiter of this.#waiters.get(id) ?? []) this.#runnable.add(waiter);
      this.#relist(id);
      this.#dropIfUnneeded(id);
      return;
    }
    this.#live.set(id, record);
    if (previous === undefined) {
      if (!this.#known(parentNode(record))) this.#unloaded.add(id);
      this.#relist(id);
    }
    if (cancellationIntent(record)) this.#intent.add(id);
    else this.#intent.delete(id);
    if (record.state.status === "completing") {
      this.#runnable.delete(id);
      this.#finalizeChecks.add(id);
    } else {
      this.#runnable.add(id);
    }
    if (record.state.status === "waiting")
      for (const on of record.state.on) addTo(this.#waiters, on, id);
  }

  #release(node: TaskNode, overlay?: Overlay): AnyTaskRecord | undefined {
    const above = this.#nearestLiveAbove(node, overlay);
    if (above?.state.status === "completing") this.#finalizeChecks.add(above.id);
    else if (above?.abortRequested === true) this.#runnable.add(above.id);
    return above;
  }

  #relist(start: Node): void {
    let node: Node = start;
    for (;;) {
      const needed = (typeof node !== "string" && this.#live.has(node)) || this.#below.has(node);
      let parent: Node | null | undefined;
      if (typeof node === "string") {
        parent = this.#edges.get(conversationOf(node));
      } else {
        const known = this.#live.get(node) ?? this.#settled.get(node);
        if (known === undefined) return;
        parent = parentNode(known);
      }
      if (parent === undefined) return;
      if (parent === null) {
        const root = conversationOf(node as `c${number}`);
        if (needed) this.#roots.add(root);
        else this.#roots.delete(root);
        return;
      }
      if ((this.#below.get(parent)?.has(node) === true) === needed) return;
      if (needed) {
        const first = !this.#below.has(parent);
        addTo(this.#below, parent, node);
        if (!first) return;
      } else {
        deleteFrom(this.#below, parent, node);
        if (this.#below.has(parent)) return;
        this.#dropIfUnneeded(parent);
      }
      node = parent;
    }
  }

  #nearestLiveAbove(node: TaskNode, overlay?: Overlay): AnyTaskRecord | undefined {
    for (let current = node; !current.background;) {
      const owner = current.owner ?? this.#edge(current.conversationId, overlay);
      if (owner === undefined || owner === null) return undefined;
      const record = overlay?.tasks.get(owner) ?? this.#live.get(owner);
      if (record !== undefined && record.state.status !== "terminal") return record;
      const above = record ?? this.#settled.get(owner);
      if (above === undefined) return undefined;
      current = above;
    }
    return undefined;
  }

  #known(node: Node): boolean {
    if (typeof node !== "string") {
      return (this.#live.has(node) || this.#settled.has(node)) && !this.#unloaded.has(node);
    }
    const owner = this.#edges.get(conversationOf(node));
    return owner === null || (owner !== undefined && this.#known(owner));
  }

  #edge(id: ConversationId, overlay?: Overlay): TaskId | null | undefined {
    return overlay?.edges.has(id) === true ? overlay.edges.get(id) : this.#edges.get(id);
  }

  #node(id: TaskId, overlay?: Overlay): TaskNode | undefined {
    return overlay?.tasks.get(id) ?? this.#live.get(id) ?? this.#settled.get(id);
  }

  *#above(start: Up, overlay?: Overlay): Generator<Step> {
    let at: Up | undefined = start;
    while (at !== undefined) {
      if ("task" in at) {
        const node = this.#node(at.task, overlay);
        if (node === undefined) {
          yield { unknown: true };
          return;
        }
        yield { task: at.task, node };
        at = parentOf(node);
      } else {
        yield { conversation: at.conversation };
        const edge = this.#edge(at.conversation, overlay);
        if (edge === undefined) {
          yield { unknown: true };
          return;
        }
        at = edge === null ? undefined : { task: edge };
      }
    }
  }

  *#walkDown(
    start: Node,
    options: {
      readonly overlay?: Overlay;
      readonly crossBackground?: boolean;
      readonly enter?: (id: TaskId) => boolean;
    } = {},
  ): Generator<{
    readonly id: TaskId;
    readonly node: TaskNode;
    readonly live: AnyTaskRecord | undefined;
  }> {
    const { overlay, crossBackground = false, enter } = options;
    const links = overlay === undefined ? undefined : this.#links(overlay);
    const pending: Node[] = [start];
    for (let at = pending.pop(); at !== undefined; at = pending.pop()) {
      for (const children of [this.#below.get(at), links?.get(at)]) {
        for (const child of children ?? []) {
          if (typeof child === "string") {
            pending.push(child);
            continue;
          }
          const record = overlay?.tasks.get(child) ?? this.#live.get(child);
          const node = record ?? this.#settled.get(child);
          if (node === undefined) continue;
          const live =
            record !== undefined && record.state.status !== "terminal" ? record : undefined;
          yield { id: child, node, live };
          if ((crossBackground || !node.background) && (enter === undefined || enter(child)))
            pending.push(child);
        }
      }
    }
  }

  #links(overlay: Overlay): ReadonlyMap<Node, ReadonlySet<Node>> {
    if (overlay.links !== undefined) return overlay.links;
    const links = new Map<Node, Set<Node>>();
    for (const record of overlay.tasks.values()) {
      if (this.#live.has(record.id) || this.#settled.has(record.id)) continue;
      let child: Node = record.id;
      let parent: Node | null | undefined = parentNode(record);
      while (parent !== undefined && parent !== null && links.get(parent)?.has(child) !== true) {
        addTo(links, parent, child);
        if (typeof parent !== "string" && (this.#live.has(parent) || overlay.tasks.has(parent)))
          break;
        let above: Node | null | undefined;
        if (typeof parent === "string") {
          above = this.#edge(conversationOf(parent), overlay);
        } else {
          const fields = this.#settled.get(parent);
          above = fields === undefined ? undefined : parentNode(fields);
        }
        if (above !== undefined && above !== null && this.#below.get(above)?.has(parent) === true)
          break;
        child = parent;
        parent = above;
      }
    }
    overlay.links = links;
    return links;
  }

  #ownedLive(
    owner: TaskId,
    options: {
      readonly overlay?: Overlay;
      readonly first?: boolean;
      readonly done?: ReadonlySet<TaskId>;
    } = {},
  ): TaskId[] {
    const { overlay, first = false, done } = options;
    const found: TaskId[] = [];
    const walk = this.#walkDown(owner, {
      ...(overlay === undefined ? {} : { overlay }),
      ...(done === undefined ? {} : { enter: (id: TaskId) => !done.has(id) }),
    });
    for (const { id, node, live } of walk) {
      if (live === undefined || node.background) continue;
      found.push(id);
      if (first) break;
    }
    return found;
  }

  #hasOwnedLive(owner: TaskId, overlay?: Overlay, done?: ReadonlySet<TaskId>): boolean {
    const options = {
      first: true,
      ...(overlay === undefined ? {} : { overlay }),
      ...(done === undefined ? {} : { done }),
    };
    return this.#ownedLive(owner, options).length > 0;
  }

  #inScope(start: Up, scope: Scope, crossBackground = false): boolean | undefined {
    for (const step of this.#above(start)) {
      if ("unknown" in step) return undefined;
      if ("conversation" in step) {
        if ("conversation" in scope && step.conversation === scope.conversation) return true;
      } else if (step.node.background && !crossBackground) {
        return false;
      }
    }
    return "roots" in scope;
  }

  #belowCancelled(start: Up): boolean {
    return this.#cancellingOwner(start) !== undefined;
  }

  #cancellingOwner(start: Up): AnyTaskRecord | undefined {
    if (this.#intent.size === 0) return undefined;
    for (const step of this.#above(start)) {
      if ("unknown" in step) return undefined;
      if (!("task" in step)) continue;
      const live = this.#live.get(step.task);
      if (live !== undefined && cancellationIntent(live)) return live;
      if (step.node.background) return undefined;
    }
    return undefined;
  }

  #failSession(error: unknown): void {
    if (!this.#closing) this.#session.fail(error);
  }

  #seal(): void {
    this.#closing = true;
    try {
      this.#unsubscribeRegistry();
    } catch (error) {
      this.#report(error);
    }
    const error = closedError(this.#session);
    this.#taskWaiters.rejectAll(error);
    this.#idleWaiters.rejectAll(error);
    this.#contexts.clear();
    if (this.#expiry !== undefined) clearTimeout(this.#expiry.timer);
    this.#expiry = undefined;
  }

  #kick(): void {
    this.#dirty = true;
    if (this.#draining || !this.#enabled || this.#closing) return;
    this.#draining = true;
    queueMicrotask(() => void this.#drain());
  }

  async #drain(): Promise<void> {
    try {
      await this.#drainPass();
    } catch (error) {
      this.#failSession(error);
    } finally {
      this.#draining = false;
      if (this.#dirty) this.#kick();
    }
  }

  async #drainPass(): Promise<void> {
    if (!this.#dirty || !this.#enabled || this.#closing) return;
    this.#dirty = false;
    for (const reservation of await this.#reserve()) this.#start(reservation);
    await this.#drainPass();
  }

  async #reserve(): Promise<Reservation[]> {
    const reservations: Reservation[] = [];
    let abandoned: TaskId[] = [];
    try {
      await this.#session.commitWith(async (tx) => {
        if (!this.#enabled || this.#closing) return;
        for (const id of this.#abandoned) {
          const record = this.#live.get(id);
          if (record !== undefined && !record.abortRequested)
            tx.setTask(withAbortMark(record, "restart"));
        }
        if (this.#abandoned.size > 0) {
          abandoned = [...this.#abandoned];
          return;
        }
        await this.#loadScopes(false);
        let snapshot: RegistrySnapshot | undefined;
        for await (const id of [...this.#runnable]) {
          const record = this.#live.get(id);
          if (
            record === undefined ||
            record.state.status === "completing" ||
            this.#invocations.has(id)
          ) {
            this.#runnable.delete(id);
            continue;
          }
          if (this.#waitingOn(record, true).length > 0) {
            this.#runnable.delete(id);
            continue;
          }
          const runnable = record as RunnableTaskRecord;
          const mode = record.abortRequested ? "abort" : "run";
          if (mode === "run" && !record.background && this.#belowCancelled(parentOf(record))) {
            this.#cascadePending = true;
            this.#scheduleReconcile();
            continue;
          }
          snapshot ??= this.#registry.snapshot();
          const resolution = this.#resolve(runnable, snapshot);
          if (resolution.kind === "blocked") {
            if (mode === "abort" && record.abortReason === undefined) {
              await this.#terminate(tx, record, { status: "orphaned", reason: resolution.reason });
            }
            continue;
          }
          if (resolution.record !== runnable || record.state.status !== "running") {
            tx.setTask(
              withState(resolution.record, {
                status: "running",
                checkpoint: resolution.record.state.checkpoint,
              }),
            );
          }
          this.#runnable.delete(id);
          const invocation = this.#createInvocation(record, mode);
          reservations.push({ invocation, task: resolution.task, snapshot });
        }
      }, this.#context);
    } catch (error) {
      for (const { invocation } of reservations) {
        this.#invocations.delete(invocation.taskId);
        this.#runnable.add(invocation.taskId);
        invocation.finish();
      }
      throw error;
    }
    for (const id of abandoned) this.#abandoned.delete(id);
    if (abandoned.length > 0) this.#dirty = true;
    return reservations;
  }

  #waitingOn(record: AnyTaskRecord, first = false): readonly TaskId[] {
    if (record.abortRequested) return this.#ownedLive(record.id, { first });
    if (record.state.status !== "waiting") return [];
    if (!first) return record.state.on.filter((id) => this.#live.has(id));
    const live = record.state.on.find((id) => this.#live.has(id));
    return live === undefined ? [] : [live];
  }

  #resolve(record: RunnableTaskRecord, snapshot: RegistrySnapshot): Resolution {
    const fit = this.#fit(record, snapshot.task(record.kind));
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
      this.#failedMigrations.set(record.id, { task: fit.task, error });
      this.#report(error);
      return { kind: "blocked", reason: "migration_failed" };
    }
  }

  #fit(record: AnyTaskRecord, task: AnyTask | undefined): Fit {
    if (task === undefined) return { reason: "missing_task" };
    const version = task.definition.version;
    if (version === record.version) return { task, migrates: false };
    if (version < record.version) return { reason: "task_too_old" };
    const failed = this.#failedMigrations.get(record.id);
    if (failed?.task === task) return { reason: "migration_failed", error: failed.error };
    return { task, migrates: true };
  }

  get indexSizes(): Readonly<
    Record<"live" | "settled" | "edges" | "below" | "roots" | "unloaded" | "dropQueue", number>
  > {
    let below = 0;
    for (const children of this.#below.values()) below += children.size;
    return {
      live: this.#live.size,
      settled: this.#settled.size,
      edges: this.#edges.size,
      below,
      roots: this.#roots.size,
      unloaded: this.#unloaded.size,
      dropQueue: this.#dropQueue.size,
    };
  }

  async inspect(
    snapshot: RegistrySnapshot,
  ): Promise<{ scheduling: HarnessInspection["scheduling"]; tasks: TaskInspection[] }> {
    await this.#loadScopes(false);
    const tasks: TaskInspection[] = [];
    for (const record of this.#live.values())
      tasks.push({ record, state: this.#inspectTask(record, snapshot) });
    const scheduling = this.#closing ? "closing" : this.#enabled ? "running" : "paused";
    return { scheduling, tasks };
  }

  #inspectTask(record: AnyTaskRecord, snapshot: RegistrySnapshot): TaskInspection["state"] {
    if (this.#invocations.has(record.id)) return { kind: "running" };
    if (record.state.status === "completing") return { kind: "completing" };
    const on = this.#waitingOn(record);
    if (on.length > 0) return { kind: "waiting", on };
    const fit = this.#fit(record, snapshot.task(record.kind));
    if ("reason" in fit) return { kind: "blocked", ...fit };
    if (fit.migrates && fit.task.definition.migrate === undefined) {
      return {
        kind: "blocked",
        reason: "migration_failed",
        error: missingMigration(record, erased(fit.task)),
      };
    }
    return { kind: "ready", migrates: fit.migrates };
  }

  #createInvocation(record: AnyTaskRecord, mode: "run" | "abort"): Invocation {
    const controller = new AbortController();
    const { promise: done, resolve: finish } = Promise.withResolvers<void>();
    const invocation: Invocation = {
      taskId: record.id,
      conversationId: record.conversationId,
      mode,
      controller,
      context: withAbortSignal(controller.signal, this.#context),
      watches: new Set(),
      ended: false,
      done,
      finish: () => finish(),
    };
    this.#invocations.set(record.id, invocation);
    return invocation;
  }

  #start(reservation: Reservation): void {
    const invocation = reservation.invocation;
    void (async () => {
      try {
        if (invocation.mode === "run") await this.#run(reservation);
        else await this.#runAbort(reservation);
      } catch (error) {
        this.#report(error);
      } finally {
        this.#end(invocation);
        invocation.finish();
        this.#kick();
      }
    })();
  }

  async #run(reservation: Reservation): Promise<void> {
    const invocation = reservation.invocation;
    const state = {
      task: reservation.task,
      snapshot: reservation.snapshot,
      reported: undefined as ReportedTask,
    };
    const phase: Phase = {
      snapshot: () => state.snapshot,
      task: () => state.task,
      agent: undefined,
    };
    const runtime = this.#runtime(invocation, phase);
    const runPhase = async (previous: PhaseResult | undefined): Promise<void> => {
      const current = await this.#step(invocation, (tx, phaseState) =>
        this.#decide(tx, phaseState, previous, state),
      );
      if (current === undefined || this.#closing) return;
      const checkpoint = current.state.checkpoint;
      phase.agent = undefined;
      let next: PhaseResult;
      try {
        await erased(state.task).phases[checkpoint.phase]!(current, runtime, invocation.context);
        next = { checkpoint };
      } catch (error) {
        next = { checkpoint, failure: { error } };
      }
      await runPhase(next);
    };
    await runPhase(undefined);
  }

  #decide(
    tx: Transaction,
    current: ErasedRunningTask,
    previous: PhaseResult | undefined,
    state: { task: AnyTask; snapshot: RegistrySnapshot; reported: ReportedTask },
  ): Decision {
    if (current.abortRequested) return false;
    if (!current.background && this.#belowCancelled(parentOf(current))) {
      this.#cascadePending = true;
      this.#scheduleReconcile();
      return false;
    }
    if (previous === undefined) return true;
    if (previous.failure !== undefined) return { fault: previous.failure.error };
    if (jsonEqual(current.state.checkpoint, previous.checkpoint)) {
      const message = `Task ${current.kind} phase ${previous.checkpoint.phase} returned without durable progress`;
      return { fault: new Error(message) };
    }
    state.snapshot = this.#registry.snapshot();
    const next = state.snapshot.task(current.kind);
    if (next !== state.task) {
      if (next !== undefined && canReserve(next, current)) {
        tx.setTask(withState(current, { status: "pending", checkpoint: current.state.checkpoint }));
        return false;
      }
      if (state.reported === undefined || state.reported.task !== next) {
        state.reported = { task: next };
        const cause = next === undefined ? "missing_task" : "incompatible_task";
        this.#report(
          new Error(`Task ${current.id} keeps running under its old ${current.kind} definition`, {
            cause,
          }),
        );
      }
    }
    return true;
  }

  async #runAbort(reservation: Reservation): Promise<void> {
    const invocation = reservation.invocation;
    const current = this.#live.get(invocation.taskId) as ErasedRunningTask | undefined;
    if (current === undefined || this.#closing) return;
    let failure: { readonly error: unknown } | undefined;
    try {
      const phase: Phase = {
        snapshot: () => reservation.snapshot,
        task: () => reservation.task,
        agent: undefined,
      };
      const runtime = this.#runtime(invocation, phase);
      await erased(reservation.task).abort(current, runtime, invocation.context);
    } catch (error) {
      failure = { error };
    }
    const message = `Abort handler of task ${invocation.taskId} returned without a terminal outcome`;
    await this.#step(invocation, () => ({ fault: failure?.error ?? new Error(message) }));
  }

  async #step(
    invocation: Invocation,
    decide: (tx: Transaction, current: ErasedRunningTask) => Decision,
  ): Promise<ErasedRunningTask | undefined> {
    try {
      return await this.#session.commitWith(async (tx) => {
        const found = this.#live.get(invocation.taskId);
        const current =
          found?.state.status === "running" ? (found as ErasedRunningTask) : undefined;
        const decision = current !== undefined && !this.#closing ? decide(tx, current) : false;
        if (decision === true) return current;
        this.#end(invocation);
        if (decision !== false) {
          const message = errorMessage(decision.fault);
          await this.#terminate(tx, current!, { status: "faulted", error: { message } });
        }
        return undefined;
      }, this.#context);
    } catch (error) {
      this.#end(invocation);
      this.#failSession(error);
      return undefined;
    }
  }

  async #terminate(
    tx: Transaction,
    record: AnyTaskRecord,
    outcome: SchedulerOutcome,
  ): Promise<void> {
    await this.#loadScopes(false);
    if (this.#hasOwnedLive(record.id, overlayOf(tx))) {
      tx.setTask(withState(record, { status: "completing", outcome }));
      return;
    }
    tx.setTask(withState(record, { status: "terminal", outcome }));
    await this.#settleOutcome(tx, record, outcome);
  }

  async #commitState(
    tx: Transaction,
    invocation: Invocation,
    current: ErasedRunningTask,
    next: NextTaskState<Checkpoint, JsonValue>,
  ): Promise<void> {
    if (next.status === "waiting")
      await this.#validateWait(tx, invocation, current, next.on, next.policy);
    if (next.status === "terminal") {
      const overlay = overlayOf(tx);
      await this.#loadScopes(false);
      for await (const record of overlay.tasks.values())
        await this.#loadChain(parentOf(record), overlay);
      if (this.#hasOwnedLive(current.id, overlay)) {
        tx.setTask(withState(current, { status: "completing", outcome: next.outcome }));
        return;
      }
    }
    tx.setTask(withState(current, next));
  }

  async #validateWait(
    tx: Transaction,
    invocation: Invocation,
    current: ErasedRunningTask,
    on: readonly TaskId[],
    policy: string,
  ): Promise<void> {
    if (invocation.mode === "abort")
      throw new Error(`Abort handler of task ${current.id} cannot wait`);
    const overlay = overlayOf(tx);
    const targets: TaskId[] = [];
    for await (const id of on) {
      const member =
        overlay.tasks.get(id) ??
        this.#live.get(id) ??
        (await this.#storage.task(id, this.#context));
      if (member === undefined) throw new Error(`Task ${id} does not exist`);
      if (policy === "failFast" && member.owner !== current.id) {
        throw new Error(
          `Task ${current.id} can wait failFast only on tasks it owns; ${id} is not one`,
        );
      }
      if (member.state.status !== "terminal" && member.owner !== current.id) targets.push(id);
    }
    if (targets.length === 0) return;
    const cycle = await this.#waitCycle(current.id, targets, overlay);
    if (cycle !== undefined) {
      throw new Error(
        `Task ${current.id} cannot wait on ${cycle[0]}: ${[current.id, ...cycle].join(" -> ")} is a wait cycle`,
      );
    }
  }

  async #waitCycle(
    task: TaskId,
    on: readonly TaskId[],
    overlay: Overlay,
  ): Promise<TaskId[] | undefined> {
    await this.#loadScopes(false);
    const from = new Map<TaskId, TaskId | undefined>();
    const walked = new Set<TaskId>();
    const pending: TaskId[] = [];
    const reach = (id: TaskId, via: TaskId | undefined) => {
      if (from.has(id)) return;
      from.set(id, via);
      pending.push(id);
    };
    const path = (end: TaskId): TaskId[] => {
      const steps: TaskId[] = [];
      for (let at: TaskId | undefined = end; at !== undefined; at = from.get(at)) steps.unshift(at);
      return steps;
    };
    for (const id of on) reach(id, undefined);
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      if (id === task) return path(id);
      const record = overlay.tasks.get(id) ?? this.#live.get(id);
      if (record === undefined || record.state.status === "terminal") continue;
      if (record.state.status === "waiting" && !record.abortRequested) {
        for (const member of record.state.on) reach(member, id);
      }
      if (walked.has(id)) continue;
      walked.add(id);
      const found: TaskId[] = [];
      const walk = this.#walkDown(id, { overlay, enter: (below) => !walked.has(below) });
      for (const { id: below, node, live } of walk) {
        if (live === undefined || node.background) continue;
        found.push(below);
        reach(below, id);
      }
      for (const below of found) walked.add(below);
    }
    return undefined;
  }

  #end(invocation: Invocation): void {
    if (invocation.ended) return;
    invocation.ended = true;
    if (this.#invocations.get(invocation.taskId) === invocation) {
      this.#invocations.delete(invocation.taskId);
      if (this.#live.has(invocation.taskId)) this.#runnable.add(invocation.taskId);
    }
    for (const watch of invocation.watches) void watch.stop();
    invocation.controller.abort(endedError(invocation));
  }

  #idle(conversationId: ConversationId | undefined): boolean {
    const scope: Scope =
      conversationId === undefined ? { roots: true } : { conversation: conversationId };
    for (const id of this.#unloaded) {
      const record = this.#live.get(id);
      if (
        record !== undefined &&
        !record.background &&
        this.#inScope(parentOf(record), scope) !== false
      )
        return false;
    }
    const starts = conversationId === undefined ? this.#roots : [conversationId];
    for (const start of starts) {
      for (const { node, live } of this.#walkDown(conversationNode(start))) {
        if (live !== undefined && !node.background) return false;
      }
    }
    return true;
  }

  #runtime(invocation: Invocation, phase: Phase): ErasedRuntime {
    const agent = (): Promise<Agent> => {
      if (invocation.ended) return Promise.reject(endedError(invocation));
      if (phase.agent === undefined) {
        phase.agent = this.#agent(invocation.conversationId, phase.snapshot(), invocation.context);
        phase.agent.catch(() => {});
      }
      return phase.agent;
    };
    const hooks: HookRunner<Record<string, unknown>> = {
      each: async (name, invoke) => {
        for await (const handlers of agentHooks(await agent(), phase.task().definition.name)) {
          const handler = (handlers as Record<string, unknown>)[name];
          if (typeof handler !== "function") continue;
          try {
            await invoke(handler.bind(handlers));
          } catch (error) {
            if (invocation.controller.signal.aborted) throw error;
            this.#report(error);
          }
        }
      },
    };
    const settings = this.#settings;
    return {
      taskId: invocation.taskId as TaskId<JsonValue>,
      conversationId: invocation.conversationId,
      signal: invocation.controller.signal,
      models: this.#models,
      agent: (context) =>
        invocation.ended
          ? Promise.reject(endedError(invocation))
          : awaitWithContext(agent(), context),
      get settings() {
        return settings();
      },
      env: (context) => this.#read(invocation, () => this.#env(invocation.conversationId, context)),
      hooks: hooks as ErasedRuntime["hooks"],
      get registry() {
        return phase.snapshot();
      },
      commit: (change, context) =>
        this.#gated(
          invocation,
          async (tx, current) => {
            const next = await change(tx, current);
            if (next !== undefined) await this.#commitState(tx, invocation, current, next);
          },
          context,
        ),
      memo: ((name: string, ...rest: readonly unknown[]) => {
        if (rest.length === 1) {
          return this.#read(invocation, () =>
            promiseTry(() => memoOf(this.#live.get(invocation.taskId), name)),
          );
        }
        const candidate = rest[0] as JsonValue;
        return this.#gated(
          invocation,
          (tx, current) => {
            const winner = memoOf(current, name);
            if (winner !== undefined) return winner;
            tx.setTask({
              ...current,
              memos: { ...current.memos, [name]: candidate },
            } as AnyTaskRecord);
            return candidate;
          },
          rest[1] as Context,
        );
      }) as ErasedRuntime["memo"],
      sleep: (until, context) => this.#sleep(invocation, until, context),
      watchDoc: ((...args: readonly unknown[]) =>
        this.#watchDoc(invocation, args)) as ErasedRuntime["watchDoc"],
      snapshot: ((...args: readonly unknown[]) =>
        this.#read(invocation, () =>
          sessionMethod(this.#session, "snapshot")(...args),
        )) as ErasedRuntime["snapshot"],
      snapshotAsOf: ((...args: readonly unknown[]) =>
        this.#read(invocation, () =>
          sessionMethod(this.#session, "snapshotAsOf")(...args),
        )) as ErasedRuntime["snapshotAsOf"],
      getTask: ((id: TaskId, context: Context) =>
        this.#read(invocation, () =>
          this.#session.readOnLine(() => this.#storage.task(id, context)),
        )) as ErasedRuntime["getTask"],
      waitForTask: ((id: TaskId, context: Context) =>
        this.#read(invocation, () =>
          this.waitForTask(id, withAbortSignal(invocation.controller.signal, context)),
        )) as ErasedRuntime["waitForTask"],
      ownedTasks: (context) =>
        this.#read(invocation, () =>
          this.#session.readOnLine(() =>
            promiseTry(() => {
              if (invocation.ended) throw endedError(invocation);
              context.abortSignal?.throwIfAborted();
              const owned: AnyTaskRecord[] = [];
              for (const node of this.#below.get(invocation.taskId) ?? []) {
                const record = typeof node === "string" ? undefined : this.#live.get(node);
                if (record?.owner === invocation.taskId) owned.push(record);
              }
              return owned
                .sort((a, b) => a.id - b.id)
                .map(
                  (record) => copyJson(record as unknown as JsonValue) as unknown as AnyTaskRecord,
                );
            }),
          ),
        ),
      abortOwned: (id, context) =>
        this.#read(invocation, async () => {
          const bound = withAbortSignal(invocation.controller.signal, context);
          const record = await this.#session.readOnLine(() => this.#storage.task(id, bound));
          if (record?.owner !== invocation.taskId) {
            throw new Error(`Task ${id} is not owned by task ${invocation.taskId}`);
          }
          if (record.state.status === "terminal") return;
          await this.abort(id, bound, true);
          await this.waitForTask(id, bound);
        }),
      outcomes: ((ids: readonly TaskId[], context: Context) =>
        this.#read(invocation, () =>
          this.#session.readOnLine(async () => {
            const outcomes: TaskOutcome<JsonValue>[] = [];
            for await (const id of ids) {
              const state = (await this.#storage.task(id, context))?.state;
              if (state?.status !== "terminal") throw new Error(`Task ${id} is not terminal`);
              outcomes.push(state.outcome);
            }
            return outcomes;
          }),
        )) as ErasedRuntime["outcomes"],
      conversation: (id, context) =>
        this.#read(invocation, () =>
          this.#conversation(
            id,
            {
              signal: invocation.controller.signal,
              check: () => {
                if (invocation.ended) throw endedError(invocation);
              },
            },
            context,
          ),
        ),
      entry: ((...args: readonly unknown[]) => {
        const [token, id, context] =
          args.length === 2
            ? [undefined, args[0] as EntryId, args[1] as Context]
            : [args[0] as { readonly kind: string }, args[1] as EntryId, args[2] as Context];
        return this.#read(invocation, async () => {
          const found = await this.#session.readOnLine(() =>
            this.#storage.entry(invocation.conversationId, id, context),
          );
          const entry: EntryRecord | undefined = found?.entry;
          return token === undefined || entry?.kind === token.kind ? entry : undefined;
        });
      }) as ErasedRuntime["entry"],
      context: (conversationId, context, options) =>
        this.#read(invocation, async () => {
          const { view, range } = await readContextFrom(
            this.#session,
            this.#storage,
            conversationId,
            context,
            options?.at,
            this.#contexts.get(conversationId)?.range,
          );
          const kept = this.#contexts.get(conversationId);
          if (
            range !== undefined &&
            !this.#closing &&
            !invocation.ended &&
            (kept === undefined || kept.range.bounds.tail <= range.bounds.tail)
          ) {
            if (!this.#idle(conversationId)) {
              this.#contexts.set(conversationId, { range, idleSince: undefined });
            } else if (this.#contextRetentionMs() > 0) {
              this.#contexts.set(conversationId, {
                range,
                idleSince: kept?.idleSince ?? this.#now(),
              });
              this.#scheduleExpiry();
            }
          }
          return view;
        }),
      now: () => {
        if (invocation.ended) throw endedError(invocation);
        return this.#now();
      },
      report: (error) => {
        if (invocation.ended) throw endedError(invocation);
        this.#report(error);
      },
    };
  }

  #read<T>(invocation: Invocation, read: () => Promise<T>): Promise<T> {
    return promiseTry(() => {
      if (invocation.ended) throw endedError(invocation);
      return read();
    });
  }

  #gated<T>(
    invocation: Invocation,
    change: (tx: Transaction, current: ErasedRunningTask) => T | Promise<T>,
    context: Context,
  ): Promise<T> {
    if (invocation.ended) return Promise.reject(endedError(invocation));
    return this.#session.commitWith(
      (tx) =>
        promiseTry(() => {
          if (invocation.ended) throw endedError(invocation);
          if (this.#closing) throw closedError(this.#session);
          const found = this.#live.get(invocation.taskId);
          if (found === undefined) throw new Error(`Task ${invocation.taskId} is terminal`);
          if (found.state.status !== "running")
            throw new Error(`Task ${invocation.taskId} is ${found.state.status}`);
          const current = found as ErasedRunningTask;
          if (invocation.mode === "run" && current.abortRequested) {
            throw new Error(`Task ${invocation.taskId} has a durable abort mark`);
          }
          return change(tx, current);
        }),
      context,
      { conversationId: invocation.conversationId, taskId: invocation.taskId },
    );
  }

  async #sleep(invocation: Invocation, until: number, context: Context): Promise<void> {
    if (invocation.ended) throw endedError(invocation);
    const signals = [invocation.controller.signal];
    if (context.abortSignal !== undefined) signals.push(context.abortSignal);
    const signal = AbortSignal.any(signals);
    const wait = async (): Promise<void> => {
      signal.throwIfAborted();
      const remaining = until - this.#now();
      if (remaining <= 0) return;
      await delay(Math.min(remaining, MAX_TIMER_DELAY), signal);
      await wait();
    };
    await wait();
  }

  async #watchDoc(
    invocation: Invocation,
    args: readonly unknown[],
  ): Promise<DocumentWatch<JsonObject> | undefined> {
    if (invocation.ended) throw endedError(invocation);
    const watch = (await sessionMethod(this.#session, "watchDoc")(...args)) as
      | DocumentWatch<JsonObject>
      | undefined;
    if (watch === undefined) return undefined;
    if (invocation.ended) {
      void watch.stop();
      throw endedError(invocation);
    }
    invocation.watches.add(watch);
    void watch.closed.then(() => invocation.watches.delete(watch));
    return watch;
  }
}

function withAbortMark(record: AnyTaskRecord, reason?: "restart"): AnyTaskRecord {
  const { abortReason: _reason, ...rest } = record;
  return {
    ...rest,
    abortRequested: true,
    ...(reason === undefined ? {} : { abortReason: reason }),
  } as AnyTaskRecord;
}

function cancellationIntent(record: AnyTaskRecord): boolean {
  return record.state.status !== "terminal" && (record.abortRequested || failedOutcome(record));
}

function failedOutcome(record: AnyTaskRecord): boolean {
  const state = record.state;
  return (
    (state.status === "completing" || state.status === "terminal") &&
    state.outcome.status !== "completed"
  );
}

function parentOf(node: TaskNode): Up {
  return node.owner === undefined ? { conversation: node.conversationId } : { task: node.owner };
}

function nodeOf(record: AnyTaskRecord): TaskNode {
  return {
    conversationId: record.conversationId,
    ...(record.owner === undefined ? {} : { owner: record.owner }),
    background: record.background,
  };
}

function overlayOf(tx: Transaction): Overlay {
  const tasks = new Map(tx.stagedTasks().map((record) => [record.id, record]));
  const edges = new Map(
    tx.stagedConversations().map((record) => [record.id, record.owner?.taskId ?? null]),
  );
  return { tasks, edges };
}

function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const values = map.get(key);
  if (values === undefined) map.set(key, new Set([value]));
  else values.add(value);
}

function deleteFrom<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const values = map.get(key);
  if (values === undefined) return;
  values.delete(value);
  if (values.size === 0) map.delete(key);
}

function memoOf(record: AnyTaskRecord | undefined, name: string): JsonValue | undefined {
  const memos = record?.memos;
  return memos !== undefined && Object.hasOwn(memos, name) ? memos[name] : undefined;
}

function sessionMethod(
  session: SessionImpl,
  name: "snapshot" | "snapshotAsOf" | "watchDoc",
): (...args: readonly unknown[]) => Promise<unknown> {
  return (session[name] as (...args: readonly unknown[]) => Promise<unknown>).bind(session);
}

function missingMigration(record: AnyTaskRecord, definition: ErasedDefinition): Error {
  return new Error(
    `Task ${record.kind} version ${definition.version} has no migration from ${record.version}`,
  );
}

function erased(task: AnyTask): ErasedDefinition {
  return task.definition as unknown as ErasedDefinition;
}

function endedError(invocation: Invocation): Error {
  return new Error(`Task ${invocation.taskId} invocation has ended`);
}

function withState(record: AnyTaskRecord, state: TaskState<JsonValue, JsonValue>): AnyTaskRecord {
  if (state.status !== "terminal" && state.status !== "completing")
    return { ...record, state } as AnyTaskRecord;
  const { memos: _memos, ...rest } = record;
  return { ...rest, state };
}

function canReserve(task: AnyTask, record: AnyTaskRecord): boolean {
  const definition = task.definition;
  return (
    definition.version === record.version ||
    (definition.version > record.version && definition.migrate !== undefined)
  );
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function jsonEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null)
    return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => jsonEqual(value, right[index]));
  }
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]));
}

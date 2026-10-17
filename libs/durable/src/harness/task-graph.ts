import {
  type AttachedReplicatedState,
  type Context,
  type JsonValue,
  replicatedState,
} from "@msa/chord";
import { withoutAbortSignal } from "@msa/chord/context";
import { applyImmutable, type Op } from "@msa/chord/delta";
import { Effect } from "effect";

import { CommittedStateSource, CommittedWatch } from "../session/observation.ts";
import { contained, type SessionImpl } from "../session/session.ts";
import type {
  CommitPublication,
  ConversationId,
  JoinPolicy,
  Storage,
  TaskId,
  TaskOutcome,
  TaskRecord,
  WatchHandle,
} from "./types.ts";
import { closedError, scanAll } from "./util.ts";

export type TaskGraphState =
  | { readonly status: "pending" | "running"; readonly phase: string }
  | {
      readonly status: "waiting";
      readonly phase: string;
      readonly on: readonly TaskId[];
      readonly policy: JoinPolicy;
    }
  | { readonly status: "completing"; readonly outcome: TaskOutcome<JsonValue>["status"] };

export type TaskGraphNode = {
  readonly id: TaskId;
  readonly kind: string;
  readonly conversationId: ConversationId;
  readonly owner?: TaskId;
  readonly background: boolean;
  readonly abortRequested: boolean;
  readonly state: TaskGraphState;
  readonly conversations: readonly ConversationId[];
};

export type TaskGraph = {
  readonly tasks: Readonly<Record<string, TaskGraphNode>>;
};

export type TaskGraphWatch = WatchHandle<TaskGraph>;

type AnyTaskRecord = TaskRecord<JsonValue, JsonValue, JsonValue>;
type Observer = CommittedStateSource<TaskGraph> | CommittedWatch<TaskGraph>;
type Mount = { value: TaskGraph; readonly observers: Set<Observer> };

const LIVE_STATUSES = ["pending", "running", "waiting", "completing"] as const;
const SCAN_PAGE_SIZE = 256;

export class TaskGraphView {
  readonly #session: SessionImpl;
  readonly #storage: Storage;
  #mount: Mount | undefined;
  #closed = false;

  constructor(session: SessionImpl, storage: Storage) {
    this.#session = session;
    this.#storage = storage;
    session.observeCommits((publication, context) => {
      if (this.#mount !== undefined)
        advance(this.#mount, publication, context, (error) => session.report(error));
    });
    session.subscribeClose(() => {
      this.#closed = true;
      for (const observer of [...(this.#mount?.observers ?? [])]) {
        contained(
          () => observer.closeSession(this.#session.failure),
          (error) => session.report(error),
        );
      }
      this.#mount = undefined;
    });
  }

  state(context: Context): Promise<AttachedReplicatedState<TaskGraph>> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const { observer, detach } = yield* this.#attach(
          (value, release) => new CommittedStateSource<TaskGraph>(value, release),
          context,
        );
        return yield* Effect.sync(() =>
          replicatedState(observer, { onError: (error) => this.#session.report(error) }),
        ).pipe(Effect.onError(() => Effect.sync(detach)));
      }),
    );
  }

  watch(context: Context): Promise<TaskGraphWatch> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const { observer } = yield* this.#attach(
          (value, release) =>
            new CommittedWatch<TaskGraph>(value, release, (error) => this.#session.report(error)),
          context,
        );
        const signal = context.abortSignal;
        if (signal?.aborted === true) {
          observer.cancel();
          return yield* Effect.die(signal.reason);
        }
        if (signal !== undefined) observer.observeCancellation(signal);
        return observer;
      }),
    );
  }

  #attach<O extends Observer>(
    create: (value: TaskGraph, release: () => void) => O,
    context: Context,
  ): Effect.Effect<{ observer: O; detach: () => void }> {
    return Effect.promise(() =>
      this.#session.readOnLine(() => Effect.runPromise(this.#mountObserver(create, context))),
    );
  }

  #mountObserver<O extends Observer>(
    create: (value: TaskGraph, release: () => void) => O,
    context: Context,
  ): Effect.Effect<{ observer: O; detach: () => void }> {
    return Effect.gen({ self: this }, function* () {
      const mount = this.#mount ?? {
        value: yield* this.#build(context),
        observers: new Set<Observer>(),
      };
      const detach = (): void => {
        mount.observers.delete(observer);
        if (mount.observers.size === 0 && this.#mount === mount) this.#mount = undefined;
      };
      const observer = create(mount.value, detach);
      if (this.#closed) throw closedError(this.#session);
      context.abortSignal?.throwIfAborted();
      this.#mount = mount;
      mount.observers.add(observer);
      return { observer, detach };
    });
  }

  #build(context: Context): Effect.Effect<TaskGraph> {
    const storage = this.#storage;
    return Effect.gen(function* () {
      const tasks: Record<string, TaskGraphNode> = {};
      const scans = yield* Effect.forEach(LIVE_STATUSES, (status) =>
        scanAll((cursor) => storage.scanTasks({ status }, SCAN_PAGE_SIZE, cursor, context)),
      );
      const records: AnyTaskRecord[] = scans.flat();
      records.sort((a, b) => a.id - b.id);
      yield* Effect.forEach(
        records,
        (record) =>
          Effect.map(
            scanAll((cursor) =>
              storage.scanConversations(
                { ownerTaskId: record.id },
                SCAN_PAGE_SIZE,
                cursor,
                context,
              ),
            ),
            (owned) => {
              const conversations = owned
                .map((conversation) => conversation.id)
                .sort((a, b) => a - b);
              tasks[String(record.id)] = nodeOf(record, conversations);
            },
          ),
        { discard: true },
      );
      return { tasks };
    });
  }
}

function advance(
  mount: Mount,
  publication: CommitPublication,
  context: Context,
  report: (error: unknown) => void,
): void {
  const ops: Op[] = [];
  const changed = new Map<string, TaskGraphNode | undefined>();
  const node = (key: string): TaskGraphNode | undefined =>
    changed.has(key) ? changed.get(key) : mount.value.tasks[key];
  for (const change of publication.changes) {
    if (change.type !== "task") continue;
    const record = change.value;
    const key = String(record.id);
    const previous = node(key);
    if (record.state.status === "terminal") {
      if (previous === undefined) continue;
      ops.push(["d", ["tasks", key]]);
      changed.set(key, undefined);
      continue;
    }
    const next = nodeOf(record, previous?.conversations ?? []);
    if (previous !== undefined && JSON.stringify(next) === JSON.stringify(previous)) continue;
    ops.push(["s", ["tasks", key], next as unknown as JsonValue]);
    changed.set(key, next);
  }
  const created = new Map<string, ConversationId[]>();
  for (const change of publication.changes) {
    if (change.type !== "conversation" || change.value.owner === undefined) continue;
    const key = String(change.value.owner.taskId);
    if (node(key) !== undefined) created.set(key, [...(created.get(key) ?? []), change.value.id]);
  }
  for (const [key, ids] of created) {
    const conversations = [...node(key)!.conversations, ...ids].sort((a, b) => a - b);
    ops.push(["s", ["tasks", key, "conversations"], conversations]);
  }
  if (ops.length === 0) return;
  mount.value = applyImmutable(mount.value, ops);
  const frameContext = withoutAbortSignal(context);
  for (const observer of [...mount.observers])
    contained(() => observer.advance(mount.value, ops, frameContext), report);
}

function nodeOf(record: AnyTaskRecord, conversations: readonly ConversationId[]): TaskGraphNode {
  return {
    id: record.id,
    kind: record.kind,
    conversationId: record.conversationId,
    ...(record.owner === undefined ? {} : { owner: record.owner }),
    background: record.background,
    abortRequested: record.abortRequested,
    state: stateOf(record),
    conversations,
  };
}

function stateOf(record: AnyTaskRecord): TaskGraphState {
  const state = record.state;
  switch (state.status) {
    case "pending":
    case "running":
      return { status: state.status, phase: phaseOf(state.checkpoint) };
    case "waiting":
      return {
        status: "waiting",
        phase: phaseOf(state.checkpoint),
        on: [...state.on],
        policy: state.policy,
      };
    case "completing":
    case "terminal":
      return { status: "completing", outcome: state.outcome.status };
  }
}

function phaseOf(checkpoint: JsonValue): string {
  return (checkpoint as { readonly phase: string }).phase;
}

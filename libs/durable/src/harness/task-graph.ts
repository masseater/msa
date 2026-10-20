import type { AttachedReplicatedState, Context, JsonValue } from "@msa/chord";
import { withoutAbortSignal } from "@msa/chord/context";
import type { Op } from "@msa/chord/delta";
import { applyImmutable } from "@msa/chord/delta/apply";
import { replicatedState } from "@msa/chord/state";
import { Effect } from "effect";

import type observationTypes from "../session/observation.types.ts";
import sessionKit from "./session-kit.ts";
import type taskGraphTypes from "./task-graph.types.ts";
import util from "./util.ts";

const { observation, sessionState } = sessionKit;

const { contained } = sessionState;
const { CommittedStateSource, CommittedWatch } = observation;
const { closedError, scanAll } = util;

type AnyTaskRecord = taskGraphTypes.TaskRecord<JsonValue, JsonValue, JsonValue>;
type Observer =
  | observationTypes.CommittedStateSource<taskGraphTypes.TaskGraph>
  | observationTypes.CommittedWatch<taskGraphTypes.TaskGraph>;
type Mount = { value: taskGraphTypes.TaskGraph; readonly observers: Set<Observer> };

const LIVE_STATUSES = ["pending", "running", "waiting", "completing"] as const;
const SCAN_PAGE_SIZE = 256;

export default class TaskGraphView {
  readonly #session: taskGraphTypes.SessionImpl;
  readonly #storage: taskGraphTypes.Storage;
  #mount: Mount | undefined;
  #closed = false;

  constructor(session: taskGraphTypes.SessionImpl, storage: taskGraphTypes.Storage) {
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

  state(context: Context): Promise<AttachedReplicatedState<taskGraphTypes.TaskGraph>> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const { observer, detach } = yield* this.#attach(
          (value, release) => new CommittedStateSource<taskGraphTypes.TaskGraph>(value, release),
          context,
        );
        return yield* Effect.sync(() =>
          replicatedState(observer, { onError: (error) => this.#session.report(error) }),
        ).pipe(Effect.onError(() => Effect.sync(detach)));
      }),
    );
  }

  watch(context: Context): Promise<taskGraphTypes.TaskGraphWatch> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const { observer } = yield* this.#attach(
          (value, release) =>
            new CommittedWatch<taskGraphTypes.TaskGraph>(value, release, (error) =>
              this.#session.report(error),
            ),
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
    create: (value: taskGraphTypes.TaskGraph, release: () => void) => O,
    context: Context,
  ): Effect.Effect<{ observer: O; detach: () => void }> {
    return Effect.promise(() =>
      this.#session.readOnLine(() => Effect.runPromise(this.#mountObserver(create, context))),
    );
  }

  #mountObserver<O extends Observer>(
    create: (value: taskGraphTypes.TaskGraph, release: () => void) => O,
    context: Context,
  ): Effect.Effect<{ observer: O; detach: () => void }> {
    return Effect.gen({ self: this }, function* () {
      const mount = this.#mount ?? {
        observers: new Set<Observer>(),
        value: yield* this.#build(context),
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
      return { detach, observer };
    });
  }

  #build(context: Context): Effect.Effect<taskGraphTypes.TaskGraph> {
    const storage = this.#storage;
    return Effect.gen(function* () {
      const tasks: Record<string, taskGraphTypes.TaskGraphNode> = {};
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
  publication: taskGraphTypes.CommitPublication,
  context: Context,
  report: (error: unknown) => void,
): void {
  const ops: Op[] = [];
  const changed = new Map<string, taskGraphTypes.TaskGraphNode | undefined>();
  const node = (key: string): taskGraphTypes.TaskGraphNode | undefined =>
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
  const created = new Map<string, taskGraphTypes.ConversationId[]>();
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

function nodeOf(
  record: AnyTaskRecord,
  conversations: readonly taskGraphTypes.ConversationId[],
): taskGraphTypes.TaskGraphNode {
  return {
    conversationId: record.conversationId,
    id: record.id,
    kind: record.kind,
    ...(record.owner === undefined ? {} : { owner: record.owner }),
    abortRequested: record.abortRequested,
    background: record.background,
    conversations,
    state: stateOf(record),
  };
}

function stateOf(record: AnyTaskRecord): taskGraphTypes.TaskGraphState {
  const state = record.state;
  switch (state.status) {
    case "pending":
    case "running":
      return { phase: phaseOf(state.checkpoint), status: state.status };
    case "waiting":
      return {
        on: [...state.on],
        phase: phaseOf(state.checkpoint),
        policy: state.policy,
        status: "waiting",
      };
    case "completing":
    case "terminal":
      return { outcome: state.outcome.status, status: "completing" };
  }
}

function phaseOf(checkpoint: JsonValue): string {
  return (checkpoint as { readonly phase: string }).phase;
}

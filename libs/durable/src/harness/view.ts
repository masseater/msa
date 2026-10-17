import type { AttachedReplicatedState, Context, JsonValue } from "@msa/chord";
import { withoutAbortSignal } from "@msa/chord/context";
import type { NonEmptyPath, Op, Path } from "@msa/chord/delta";
import { applyImmutable } from "@msa/chord/delta/apply";
import { replicatedState } from "@msa/chord/state";

import { CommittedStateSource, CommittedWatch } from "../session/observation.ts";
import { contained, type SessionImpl } from "../session/session.ts";
import type {
  CommitPublication,
  ConversationDocToken,
  ConversationId,
  ConversationRecord,
  DocumentId,
  EntryRecord,
  JsonObject,
  Storage,
  WatchHandle,
} from "../types.ts";
import { AgentDoc } from "./agent.ts";
import { activeEntries, captureContextBounds } from "./context.ts";
import { InboxDoc } from "./inbox.ts";
import { LiveDoc } from "./live.ts";
import { ProviderDoc } from "./provider.ts";
import { UsageDoc } from "./usage.ts";
import { closedError } from "./util.ts";

/** Structural mount of one conversation's active transcript and built-in documents (spec §9.3). */
export type ConversationView = {
  readonly conversation: ConversationRecord;
  /** Raw active entries, as `ContextView.entries`: the head marker, then the non-head entries from its head. */
  readonly entries: readonly EntryRecord[];
  /** Built-in conversation documents keyed by kind; absent documents are absent. */
  readonly docs: Readonly<Record<string, JsonObject>>;
};

/** Receives each next revision of a mount, and the Session's close. */
export type ViewObserver = {
  advance?(value: ConversationView, ops: readonly Op[], context: Context): void;
  /** Every publication, after the mount took it; `ops` are the mount's, possibly none. */
  publication?(
    before: ConversationView,
    after: ConversationView,
    ops: readonly Op[],
    publication: CommitPublication,
    context: Context,
  ): void;
  closeSession(failure: { readonly error: unknown } | undefined): void;
};

const MOUNTED = [
  AgentDoc,
  LiveDoc,
  InboxDoc,
  ProviderDoc,
  UsageDoc,
] as unknown as readonly ConversationDocToken<JsonObject>[];
const MOUNTED_KINDS: ReadonlySet<string> = new Set(MOUNTED.map((token) => token.definition.kind));

/** One conversation's mount: its current revision, the document incarnations it shows, and its observers. */
type Mount = {
  value: ConversationView;
  /** Mounted incarnation and definition version per kind; another incarnation or version is set whole. */
  readonly docs: Map<string, { id: DocumentId; version: number }>;
  readonly observers: Set<ViewObserver>;
};

const VIEWS = new WeakMap<object, ConversationViews>();

/**
 * The view mounts of a Harness, for adapters built on them.
 * @param {object} harness - The Harness.
 * @returns {ConversationViews} The view mounts.
 */
export function conversationViews(harness: object): ConversationViews {
  const views = VIEWS.get(harness);
  if (views === undefined) throw new Error("Not a Harness");
  return views;
}

/**
 * The Harness's conversation view mounts: at most one per conversation, built on the Session line by its first
 * observer and dropped with its last. Each mount advances from the Session's commit publications, which are durable.
 */
export class ConversationViews {
  readonly #session: SessionImpl;
  readonly #storage: Storage;
  readonly #mounts = new Map<ConversationId, Mount>();
  #closed = false;

  constructor(session: SessionImpl, storage: Storage) {
    this.#session = session;
    this.#storage = storage;
    VIEWS.set(session, this);
    session.observeCommits((publication, context) => {
      for (const [id, mount] of this.#mounts)
        advance(id, mount, publication, context, (error) => this.report(error));
    });
    session.subscribeClose(() => {
      this.#closed = true;
      for (const mount of this.#mounts.values())
        for (const observer of [...mount.observers]) {
          contained(
            () => observer.closeSession(this.#session.failure),
            (error) => this.report(error),
          );
        }
      this.#mounts.clear();
    });
  }

  /**
   * Report an observer's listener error through the Harness.
   * @param {unknown} error - The error.
   */
  report(error: unknown): void {
    this.#session.report(error);
  }

  /**
   * A disposable read-only Chord state of the view.
   * @param {ConversationId} id - The conversation.
   * @param {Context} context - The caller's context.
   * @returns {Promise<AttachedReplicatedState<ConversationView>>} The state.
   */
  async state(
    id: ConversationId,
    context: Context,
  ): Promise<AttachedReplicatedState<ConversationView>> {
    const { observer, detach } = await this.attach(
      id,
      (value, release) => new CommittedStateSource<ConversationView>(value, release),
      context,
    );
    try {
      return replicatedState(observer, { onError: (error) => this.#session.report(error) });
    } catch (error) {
      detach();
      throw error;
    }
  }

  /**
   * A serialized exact-frame watch of the view; cancelling `context` stops it.
   * @param {ConversationId} id - The conversation.
   * @param {Context} context - The caller's context.
   * @returns {Promise<WatchHandle<ConversationView>>} The watch.
   */
  async watch(id: ConversationId, context: Context): Promise<WatchHandle<ConversationView>> {
    const { observer } = await this.attach(
      id,
      (value, release) =>
        new CommittedWatch<ConversationView>(value, release, (error) =>
          this.#session.report(error),
        ),
      context,
    );
    const signal = context.abortSignal;
    if (signal?.aborted) {
      observer.cancel();
      throw signal.reason;
    }
    if (signal !== undefined) observer.observeCancellation(signal);
    return observer;
  }

  /**
   * Register an observer created from the current revision, atomically on the Session line: it sees every later
   * publication and nothing earlier. `create` may read committed Storage, still on the line. `release` drops it, and
   * the mount with its last observer.
   * @param {ConversationId} id - The conversation.
   * @param {Function} create - Creates the observer.
   * @param {Context} context - The caller's context.
   * @returns {Promise<{ observer: O; detach: () => void }>} The observer and its detach.
   */
  attach<O extends ViewObserver>(
    id: ConversationId,
    create: (value: ConversationView, release: () => void, storage: Storage) => O | Promise<O>,
    context: Context,
  ): Promise<{ observer: O; detach: () => void }> {
    return this.#session.readOnLine(async () => {
      const mount = this.#mounts.get(id) ?? (await this.#build(id, context));
      const detach = (): void => {
        mount.observers.delete(observer);
        if (mount.observers.size === 0 && this.#mounts.get(id) === mount) this.#mounts.delete(id);
      };
      const observer = await create(mount.value, detach, this.#storage);
      // Close or cancellation may begin while the mount hydrates; register nothing then.
      if (this.#closed) throw closedError(this.#session);
      context.abortSignal?.throwIfAborted();
      this.#mounts.set(id, mount);
      mount.observers.add(observer);
      return { observer, detach };
    });
  }

  async #build(id: ConversationId, context: Context): Promise<Mount> {
    const conversation = await this.#storage.conversation(id, context);
    if (conversation === undefined) throw new Error(`Conversation ${id} does not exist`);
    const bounds = await captureContextBounds(this.#storage, id, context);
    const entries = await activeEntries(this.#storage, id, bounds, context);
    const docs: Record<string, JsonObject> = {};
    const incarnations = new Map<string, { id: DocumentId; version: number }>();
    for await (const token of MOUNTED) {
      const loaded = await this.#session.conversationDocumentOnLine(token, id, context);
      if (loaded === undefined) continue;
      docs[token.definition.kind] = loaded.value;
      incarnations.set(token.definition.kind, { id: loaded.record.id, version: loaded.version });
    }
    return { value: { conversation, entries, docs }, docs: incarnations, observers: new Set() };
  }
}

/**
 * Derive the mount's operations from one publication, apply them, and hand the revision to every observer; one that
 * throws is reported through `report`, and the others still get it.
 * @param {ConversationId} id - The conversation.
 * @param {Mount} mount - The mount.
 * @param {CommitPublication} publication - The publication.
 * @param {Context} context - The caller's context.
 * @param {(error: unknown) => void} report - Receives errors that must not fail the caller.
 */
function advance(
  id: ConversationId,
  mount: Mount,
  publication: CommitPublication,
  context: Context,
  report: (error: unknown) => void,
): void {
  const docOps: Op[] = [];
  const entryOps: Op[] = [];
  const list: EntryList = { entries: mount.value.entries, owned: false };
  // Entry writes are published in ID order.
  for (const change of publication.changes) {
    if (change.type === "entry" && change.value.conversationId === id) {
      addEntry(list, change.value, entryOps);
    } else if (change.type === "document" && change.conversationId === id) {
      applyDocument(mount, change, docOps);
    }
  }
  const { entries } = list;
  const before = mount.value;
  const ops = [...docOps, ...entryOps];
  const frameContext = withoutAbortSignal(context);
  if (ops.length > 0) {
    const value = docOps.length === 0 ? mount.value : applyImmutable(mount.value, docOps);
    mount.value = entries === value.entries ? value : { ...value, entries };
    for (const observer of [...mount.observers]) {
      contained(() => observer.advance?.(mount.value, ops, frameContext), report);
    }
  }
  for (const observer of [...mount.observers]) {
    contained(
      () => observer.publication?.(before, mount.value, ops, publication, frameContext),
      report,
    );
  }
}

// `owned` once `entries` is a copy this publication may append to; until then it is the mount's own list.
type EntryList = { entries: readonly EntryRecord[]; owned: boolean };

function addEntry(list: EntryList, entry: EntryRecord, entryOps: Op[]): void {
  const value = entry as unknown as JsonValue;
  if (entry.head === undefined) {
    entryOps.push(["p", ["entries"], list.entries.length, 0, [value]]);
    const entries = list.owned ? (list.entries as EntryRecord[]) : list.entries.slice();
    entries.push(entry);
    list.entries = entries;
    list.owned = true;
    return;
  }
  // A head marker keeps the non-head entries from its head, which are always a suffix, and goes in front.
  const target = entry.head;
  let kept = list.entries.findIndex(
    (candidate) => candidate.head === undefined && candidate.id >= target,
  );
  if (kept < 0) kept = list.entries.length;
  entryOps.push(["p", ["entries"], 0, kept, [value]]);
  list.entries = [entry, ...list.entries.slice(kept)];
  list.owned = true;
}

function applyDocument(
  mount: Mount,
  change: Extract<CommitPublication["changes"][number], { type: "document" }>,
  docOps: Op[],
): void {
  const kind = change.record.kind;
  if (!MOUNTED_KINDS.has(kind) || change.record.key !== undefined) return;
  const path: NonEmptyPath = ["docs", kind];
  const mounted = mount.docs.get(kind);
  if (change.value === null) {
    if (mounted?.id !== change.record.id) return;
    mount.docs.delete(kind);
    docOps.push(["d", path]);
  } else if (mounted?.id === change.record.id && mounted.version === change.version) {
    for (const op of change.ops) docOps.push(prefixed(op, path));
  } else {
    mount.docs.set(kind, { id: change.record.id, version: change.version! });
    docOps.push(["s", path, change.value]);
  }
}

/**
 * `op` moved under `prefix`; a root replacement becomes a set of the prefix.
 * @param {Op} op - The operation.
 * @param {NonEmptyPath} prefix - The prefix.
 * @returns {Op} The moved operation.
 */
function prefixed(op: Op, prefix: NonEmptyPath): Op {
  const at = (path: Path): NonEmptyPath => [...prefix, ...path] as unknown as NonEmptyPath;
  switch (op[0]) {
    case "r":
      return ["s", prefix, op[1]];
    case "p":
      return ["p", at(op[1]), op[2], op[3], op[4]];
    case "m":
      return ["m", at(op[1]), op[2]];
    case "s":
      return ["s", at(op[1]), op[2]];
    case "d":
      return ["d", at(op[1])];
    case "a":
      return ["a", at(op[1]), op[2]];
    case "t":
      return ["t", at(op[1]), op[2]];
  }
}

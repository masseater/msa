import { type AttachedReplicatedState, type Context, replicatedState } from "@msa/chord";
import { Effect } from "effect";

import { CommittedStateSource, CommittedWatch } from "../session/observation.ts";
import { contained, type SessionImpl } from "../session/session.ts";
import { activeEntries, captureContextBounds } from "./context.ts";
import type { ConversationId, DocumentId, JsonObject, Storage, WatchHandle } from "./types.ts";
import { closedError } from "./util.ts";
import { advance } from "./view-advance.ts";
import { type Mount, MOUNTED } from "./view-mount.ts";
import type { ConversationView, ViewObserver } from "./view-types.ts";

export type { ConversationView, ViewObserver } from "./view-types.ts";

const VIEWS = new WeakMap<object, ConversationViews>();

export function conversationViews(harness: object): ConversationViews {
  const views = VIEWS.get(harness);
  if (views === undefined) throw new Error("Not a Harness");
  return views;
}

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
        advance(id, mount, publication, context, (error) => {
          this.report(error);
        });
    });
    session.subscribeClose(() => {
      this.#closeMounts();
    });
  }

  report(error: unknown): void {
    this.#session.report(error);
  }

  state(id: ConversationId, context: Context): Promise<AttachedReplicatedState<ConversationView>> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const attached = yield* Effect.promise(() =>
          this.attach(
            id,
            (value, release) => new CommittedStateSource<ConversationView>(value, release),
            context,
          ),
        );
        return yield* Effect.onError(
          Effect.sync(() =>
            replicatedState(attached.observer, {
              onError: (error) => {
                this.#session.report(error);
              },
            }),
          ),
          () => Effect.sync(attached.detach),
        );
      }),
    );
  }

  watch(id: ConversationId, context: Context): Promise<WatchHandle<ConversationView>> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const { observer } = yield* Effect.promise(() =>
          this.attach(
            id,
            (value, release) =>
              new CommittedWatch<ConversationView>(value, release, (error) => {
                this.#session.report(error);
              }),
            context,
          ),
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

  attach<O extends ViewObserver>(
    id: ConversationId,
    create: (value: ConversationView, release: () => void, storage: Storage) => O | Promise<O>,
    context: Context,
  ): Promise<{ observer: O; detach: () => void }> {
    return this.#session.readOnLine(() => Effect.runPromise(this.#attach(id, create, context)));
  }

  #attach = Effect.fnUntraced(function* <O extends ViewObserver>(
    this: ConversationViews,
    id: ConversationId,
    create: (value: ConversationView, release: () => void, storage: Storage) => O | Promise<O>,
    context: Context,
  ) {
    const existing = this.#mounts.get(id);
    const mount = existing ?? (yield* this.#build(id, context));
    const detach = (): void => {
      mount.observers.delete(observer);
      if (mount.observers.size === 0 && this.#mounts.get(id) === mount) this.#mounts.delete(id);
    };
    const observer = yield* Effect.promise(() =>
      Promise.resolve(create(mount.value, detach, this.#storage)),
    );
    if (this.#closed) return yield* Effect.die(closedError(this.#session));
    context.abortSignal?.throwIfAborted();
    this.#mounts.set(id, mount);
    mount.observers.add(observer);
    return { observer, detach };
  });

  #build = Effect.fnUntraced(function* (
    this: ConversationViews,
    id: ConversationId,
    context: Context,
  ) {
    const conversation = yield* Effect.promise(() => this.#storage.conversation(id, context));
    if (conversation === undefined)
      return yield* Effect.die(new Error(`Conversation ${id} does not exist`));
    const bounds = yield* captureContextBounds(this.#storage, id, context, undefined);
    const entries = yield* activeEntries(this.#storage, id, bounds, context);
    const docs: Record<string, JsonObject> = {};
    const incarnations = new Map<string, { id: DocumentId; version: number }>();
    yield* Effect.forEach(
      MOUNTED,
      (token) =>
        Effect.gen({ self: this }, function* () {
          const loaded = yield* Effect.promise(() =>
            this.#session.conversationDocumentOnLine(token, id, context),
          );
          if (loaded === undefined) return;
          docs[token.definition.kind] = loaded.value;
          incarnations.set(token.definition.kind, {
            id: loaded.record.id,
            version: loaded.version,
          });
        }),
      { discard: true },
    );
    return {
      value: { conversation, entries, docs },
      docs: incarnations,
      observers: new Set(),
    } satisfies Mount;
  });

  #closeMounts(): void {
    this.#closed = true;
    for (const mount of this.#mounts.values())
      for (const observer of [...mount.observers]) {
        contained(
          () => observer.closeSession(this.#session.failure),
          (error) => {
            this.report(error);
          },
        );
      }
    this.#mounts.clear();
  }
}

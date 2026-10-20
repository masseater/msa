import chord from "@msa/chord";
import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import contextModule from "./context.ts";
import conversationViewsKit from "./conversation-views-kit.ts";
import util from "./util.ts";
import viewAdvance from "./view-advance.ts";
import viewMount from "./view-mount.ts";
import type viewTypesModule from "./view-types.ts";
import type viewTypes from "./view.types.ts";

const { observation, sessionState } = conversationViewsKit;

const { replicatedState } = chord;

const { advance } = viewAdvance;
const { CommittedStateSource, CommittedWatch } = observation;
const { closedError } = util;
const { activeEntries, captureContextBounds } = contextModule;
const { MOUNTED } = viewMount;
const { contained } = sessionState;

const VIEWS = new WeakMap<object, ConversationViews>();

export default class ConversationViews {
  static of(harness: object): ConversationViews {
    const views = VIEWS.get(harness);
    if (views === undefined) throw new Error("Not a Harness");
    return views;
  }

  readonly #session: viewTypes.SessionImpl;
  readonly #storage: viewTypes.Storage;
  readonly #mounts = new Map<viewTypes.ConversationId, viewTypes.Mount>();
  #closed = false;

  constructor(session: viewTypes.SessionImpl, storage: viewTypes.Storage) {
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

  state(
    id: viewTypes.ConversationId,
    context: chordTypes.Context,
  ): Promise<chordTypes.AttachedReplicatedState<viewTypesModule.ConversationView>> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const attached = yield* Effect.promise(() =>
          this.attach(
            id,
            (value, release) =>
              new CommittedStateSource<viewTypesModule.ConversationView>(value, release),
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

  watch(
    id: viewTypes.ConversationId,
    context: chordTypes.Context,
  ): Promise<viewTypes.WatchHandle<viewTypesModule.ConversationView>> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const { observer } = yield* Effect.promise(() =>
          this.attach(
            id,
            (value, release) =>
              new CommittedWatch<viewTypesModule.ConversationView>(value, release, (error) => {
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

  attach<O extends viewTypesModule.ViewObserver>(
    id: viewTypes.ConversationId,
    create: (
      value: viewTypesModule.ConversationView,
      release: () => void,
      storage: viewTypes.Storage,
    ) => O | Promise<O>,
    context: chordTypes.Context,
  ): Promise<{ observer: O; detach: () => void }> {
    return this.#session.readOnLine(() => Effect.runPromise(this.#attach(id, create, context)));
  }

  #attach = Effect.fnUntraced(function* <O extends viewTypesModule.ViewObserver>(
    this: ConversationViews,
    id: viewTypes.ConversationId,
    create: (
      value: viewTypesModule.ConversationView,
      release: () => void,
      storage: viewTypes.Storage,
    ) => O | Promise<O>,
    context: chordTypes.Context,
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
    return { detach, observer };
  });

  #build = Effect.fnUntraced(function* (
    this: ConversationViews,
    id: viewTypes.ConversationId,
    context: chordTypes.Context,
  ) {
    const conversation = yield* Effect.promise(() => this.#storage.conversation(id, context));
    if (conversation === undefined)
      return yield* Effect.die(new Error(`Conversation ${id} does not exist`));
    const bounds = yield* captureContextBounds(this.#storage, id, context, undefined);
    const entries = yield* activeEntries(this.#storage, id, bounds, context);
    const docs: Record<string, viewTypes.JsonObject> = {};
    const incarnations = new Map<string, { id: viewTypes.DocumentId; version: number }>();
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
      docs: incarnations,
      observers: new Set(),
      value: { conversation, docs, entries },
    } satisfies viewTypes.Mount;
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

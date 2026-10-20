import type { Context } from "@msa/chord";
import { BACKGROUND_CONTEXT, withAbortSignal as withAbortSignalModule } from "@msa/chord/context";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";

import clockModule from "../src/clock.ts";
import SessionImpl from "../src/session/session.ts";
import type sessionTypes from "../src/session/session.types.ts";
import effectSupport from "./effect-support.ts";
import type sessionSupportTypes from "./session-support.types.ts";

const { MemoryStorage } = memory;

const { currentTimeMillis } = clockModule;

const { awaited } = effectSupport;

const context: Context = BACKGROUND_CONTEXT;

type Deferred = PromiseWithResolvers<void>;

const deferred = (): Deferred => Promise.withResolvers<void>();

class ControlledStorage extends MemoryStorage {
  readonly admittedCommits: (readonly durableTypes.StorageWrite[])[] = [];
  readonly commits: (readonly durableTypes.StorageWrite[])[] = [];
  mintCount = 0;
  documentReadCount = 0;
  #commitGate: { gate: Deferred; entered: Deferred } | undefined;
  #findGate: { gate: Deferred; entered: Deferred } | undefined;
  #commitFailure: Error | undefined;

  holdCommits(): sessionSupportTypes.Gate {
    const held = { entered: deferred(), gate: deferred() };
    this.#commitGate = held;
    return { entered: held.entered.promise, release: () => this.#release("commit", held) };
  }

  holdFindDocument(): sessionSupportTypes.Gate {
    const held = { entered: deferred(), gate: deferred() };
    this.#findGate = held;
    return { entered: held.entered.promise, release: () => this.#release("find", held) };
  }

  crash(): void {
    this.#commitGate = undefined;
  }

  failNextCommit(error: Error): void {
    this.#commitFailure = error;
  }

  reopen(): this {
    (this as unknown as { closed: boolean }).closed = false;
    return this;
  }

  #release(kind: "commit" | "find", held: { gate: Deferred }): void {
    if (kind === "commit" && this.#commitGate === held) this.#commitGate = undefined;
    if (kind === "find" && this.#findGate === held) this.#findGate = undefined;
    held.gate.resolve();
  }

  override commit(
    writes: readonly durableTypes.StorageWrite[],
    commitContext: Context,
  ): Promise<durableTypes.Seq> {
    const superCommit = super.commit.bind(this);
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        this.admittedCommits.push(writes);
        this.commits.push(structuredClone(writes));
        const held = this.#commitGate;
        if (held !== undefined) {
          held.entered.resolve();
          yield* awaited(held.gate.promise);
        }
        const failure = this.#commitFailure;
        if (failure !== undefined) {
          this.#commitFailure = undefined;
          throw failure;
        }
        return yield* awaited(superCommit(writes, commitContext));
      }),
    );
  }

  override mintId<I extends durableTypes.Id<string>>(): Promise<I> {
    this.mintCount++;
    return super.mintId<I>();
  }

  override document(
    id: durableTypes.DocumentId,
    at: durableTypes.DocumentPoint,
    callContext: Context,
  ) {
    this.documentReadCount++;
    return super.document(id, at, callContext);
  }

  override findDocument(
    address: durableTypes.DocumentAddress,
    at: durableTypes.DocumentPoint,
    callContext: Context,
  ): Promise<durableTypes.DocumentRecord | undefined> {
    const superFindDocument = super.findDocument.bind(this);
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const held = this.#findGate;
        if (held !== undefined) {
          held.entered.resolve();
          yield* awaited(held.gate.promise);
        }
        return yield* awaited(superFindDocument(address, at, callContext));
      }),
    );
  }
}

function openTestSession(): {
  readonly storage: ControlledStorage;
  readonly session: sessionTypes.SessionImpl;
  readonly publications: durableTypes.CommitPublication[];
} {
  const storage = new ControlledStorage();
  const session = new SessionImpl(storage, currentTimeMillis, () => 600_000);
  const publications: durableTypes.CommitPublication[] = [];
  session.subscribeCommits((publication) => {
    publications.push(publication);
  });
  return { publications, session, storage };
}

function documentChanges(
  publication: durableTypes.CommitPublication,
): readonly Extract<durableTypes.DocumentCommitChange, { readonly type: "document" }>[] {
  return publication.changes.filter(
    (change): change is Extract<durableTypes.DocumentCommitChange, { readonly type: "document" }> =>
      change.type === "document",
  );
}

function documentCopyChanges(
  publication: durableTypes.CommitPublication,
): readonly Extract<durableTypes.DocumentCommitChange, { readonly type: "document.copy" }>[] {
  return publication.changes.filter(
    (
      change,
    ): change is Extract<durableTypes.DocumentCommitChange, { readonly type: "document.copy" }> =>
      change.type === "document.copy",
  );
}

function createConversation(
  session: sessionTypes.SessionImpl,
): Promise<durableTypes.ConversationId> {
  return Promise.resolve(
    session.commit(
      (tx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            return (yield* awaited(tx.createConversation({ ownership: { kind: "ownerless" } }))).id;
          }),
        ),
      context,
    ),
  );
}

const flush: Effect.Effect<void> = Effect.sleep(1);

const sessionSupport = {
  BACKGROUND_CONTEXT,
  ControlledStorage,
  context,
  createConversation,
  documentChanges,
  documentCopyChanges,
  flush,
  openTestSession,
  withAbortSignal: withAbortSignalModule,
};

export default sessionSupport;

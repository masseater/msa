import type { Context } from "@msa/chord";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import type {
  CommitPublication,
  ConversationId,
  DocumentAddress,
  DocumentCommitChange,
  DocumentId,
  DocumentPoint,
  DocumentRecord,
  Id,
  Seq,
  StorageWrite,
} from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";

import { currentTimeMillis } from "../src/clock.ts";
import { SessionImpl } from "../src/session/session.ts";
import { awaited } from "./effect-support.ts";

export const context: Context = BACKGROUND_CONTEXT;

type Deferred = PromiseWithResolvers<void>;

const deferred = (): Deferred => Promise.withResolvers<void>();

export type Gate = {
  readonly entered: Promise<void>;
  release(): void;
};

export class ControlledStorage extends MemoryStorage {
  readonly admittedCommits: (readonly StorageWrite[])[] = [];
  readonly commits: (readonly StorageWrite[])[] = [];
  mintCount = 0;
  documentReadCount = 0;
  #commitGate: { gate: Deferred; entered: Deferred } | undefined;
  #findGate: { gate: Deferred; entered: Deferred } | undefined;
  #commitFailure: Error | undefined;

  holdCommits(): Gate {
    const held = { gate: deferred(), entered: deferred() };
    this.#commitGate = held;
    return { entered: held.entered.promise, release: () => this.#release("commit", held) };
  }

  holdFindDocument(): Gate {
    const held = { gate: deferred(), entered: deferred() };
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

  override commit(writes: readonly StorageWrite[], commitContext: Context): Promise<Seq> {
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

  override mintId<I extends Id<string>>(): Promise<I> {
    this.mintCount++;
    return super.mintId<I>();
  }

  override document(id: DocumentId, at: DocumentPoint, callContext: Context) {
    this.documentReadCount++;
    return super.document(id, at, callContext);
  }

  override findDocument(
    address: DocumentAddress,
    at: DocumentPoint,
    callContext: Context,
  ): Promise<DocumentRecord | undefined> {
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

export function openTestSession(): {
  readonly storage: ControlledStorage;
  readonly session: SessionImpl;
  readonly publications: CommitPublication[];
} {
  const storage = new ControlledStorage();
  const session = new SessionImpl(storage, currentTimeMillis, () => 600_000);
  const publications: CommitPublication[] = [];
  session.subscribeCommits((publication) => {
    publications.push(publication);
  });
  return { storage, session, publications };
}

export function documentChanges(
  publication: CommitPublication,
): readonly Extract<DocumentCommitChange, { readonly type: "document" }>[] {
  return publication.changes.filter(
    (change): change is Extract<DocumentCommitChange, { readonly type: "document" }> =>
      change.type === "document",
  );
}

export function documentCopyChanges(
  publication: CommitPublication,
): readonly Extract<DocumentCommitChange, { readonly type: "document.copy" }>[] {
  return publication.changes.filter(
    (change): change is Extract<DocumentCommitChange, { readonly type: "document.copy" }> =>
      change.type === "document.copy",
  );
}

export function createConversation(session: SessionImpl): Promise<ConversationId> {
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

export const flush: Effect.Effect<void> = Effect.sleep(1);

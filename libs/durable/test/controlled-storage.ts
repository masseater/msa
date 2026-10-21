import type chordTypes from "@msa/chord/index.types";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";

import effectSupport from "./effect-support.ts";
import type sessionSupportTypes from "./session-support.types.ts";
const { awaited } = effectSupport;

type Deferred = PromiseWithResolvers<void>;
const deferred = (): Deferred => Promise.withResolvers<void>();
export default class ControlledStorage extends memory.MemoryStorage {
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
    commitContext: chordTypes.Context,
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
    callContext: chordTypes.Context,
  ) {
    this.documentReadCount++;
    return super.document(id, at, callContext);
  }

  override findDocument(
    address: durableTypes.DocumentAddress,
    at: durableTypes.DocumentPoint,
    callContext: chordTypes.Context,
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

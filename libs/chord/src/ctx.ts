import { Effect } from "effect";

import type { AnyContract, InputOf, Ref } from "./contract.ts";
import type { HostCore, RefCore } from "./core.ts";
import { ChordError, invalid } from "./errors.ts";
import type { ObjectImpl } from "./object.ts";
import type { RemoteHost } from "./remote-types.ts";
import { awaitReady, linkedSignal } from "./signal.ts";
import type { Ctx, GetOptions } from "./types.ts";

export class CtxImpl implements Ctx {
  readonly host: HostCore;
  readonly signal: AbortSignal;
  readonly rootId: string;
  readonly codeVersion: number;
  readonly principal: unknown;
  readonly holder: boolean;
  readonly #refs: RefCore[] = [];
  readonly #release: () => void;
  readonly #closing = new AbortController();
  #closed = false;

  get closed(): boolean {
    return this.#closed;
  }

  check(host: HostCore | RemoteHost): void {
    if (this.host !== host) throw invalid("foreign_ctx", "ctx belongs to another host");
    if (this.#closed)
      throw new ChordError("aborted", "ctx expired: its call already settled", {
        reason: "expired",
      });
    if (this.signal.aborted) {
      const reason: unknown = this.signal.reason;
      if (reason instanceof ChordError && reason.code === "superseded")
        throw new ChordError("superseded", reason.message, { cause: reason });
      throw new ChordError("aborted", "ctx aborted", { cause: reason });
    }
  }

  constructor(
    host: HostCore,
    fields: {
      signals: readonly AbortSignal[];
      rootId: string;
      codeVersion: number;
      principal: unknown;
      holder?: boolean;
    },
  ) {
    this.host = host;
    const linked = linkedSignal(fields.signals);
    this.signal = linked.signal;
    this.#release = linked.release;
    this.rootId = fields.rootId;
    this.codeVersion = fields.codeVersion;
    this.principal = fields.principal;
    this.holder = fields.holder ?? false;
  }

  get<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions): Promise<Ref<C>> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        this.check(this.host);
        const ref = this.host.acquire(
          type,
          input,
          { principal: this.principal, ...options },
          "call",
        );
        this.#refs.push(ref);
        yield* awaitReady(ref, [this.signal, this.#closing.signal], this.host.readyTimeout);
        return ref.proxy as Ref<C>;
      }),
    );
  }

  child(object: ObjectImpl): CtxImpl {
    return new CtxImpl(this.host, {
      signals: [this.signal, object.callAbort.signal],
      rootId: this.rootId,
      codeVersion: this.codeVersion,
      principal: this.host.principal,
    });
  }

  close(): void {
    this.#closed = true;
    this.#closing.abort(
      new ChordError("aborted", "ctx expired: its call already settled", { reason: "expired" }),
    );
    this.#release();
    for (const ref of this.#refs.splice(0)) ref.release();
  }
}

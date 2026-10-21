import { Effect } from "effect";

import type contractTypes from "./contract.types.ts";
import type coreTypes from "./core.types.ts";
import errorsModule from "./errors.ts";
import type objectTypes from "./object.types.ts";
import type remoteTypesModule from "./remote-types.ts";
import signalModule from "./signal.ts";
import type typesModule from "./types.types.ts";

const { ChordError, invalid } = errorsModule;
const { awaitReady, linkedSignal } = signalModule;

export default class CtxImpl implements typesModule.Ctx {
  readonly host: coreTypes.HostCore;
  readonly signal: AbortSignal;
  readonly rootId: string;
  readonly codeVersion: number;
  readonly principal: unknown;
  readonly holder: boolean;
  readonly #refs: coreTypes.RefCore[] = [];
  readonly #release: () => void;
  readonly #closing = new AbortController();
  #closed = false;

  get closed(): boolean {
    return this.#closed;
  }

  check(host: coreTypes.HostCore | remoteTypesModule.RemoteHost): void {
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
    host: coreTypes.HostCore,
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

  get<C extends contractTypes.AnyContract>(
    type: C,
    input: contractTypes.InputOf<C>,
    options?: typesModule.GetOptions,
  ): Promise<contractTypes.Ref<C>> {
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
        return ref.proxy as contractTypes.Ref<C>;
      }),
    );
  }

  child(object: objectTypes.ObjectImpl): CtxImpl {
    return new CtxImpl(this.host, {
      codeVersion: this.codeVersion,
      principal: this.host.principal,
      rootId: this.rootId,
      signals: [this.signal, object.callAbort.signal],
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

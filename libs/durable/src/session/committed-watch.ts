import type { Context, JsonValue } from "@msa/chord";
import { withoutAbortSignal } from "@msa/chord/context";
import type { Op } from "@msa/chord/delta";
import { Cause, Effect, Exit } from "effect";

import errors from "../errors.ts";
import type typesModule from "../types.types.ts";
import type committedStateSourceTypes from "./committed-state-source.types.ts";

const { errorMessage } = errors;

const MAX_PENDING_WATCH_FRAMES = 100;

type WatchFrame<T> = {
  readonly value: T;
  readonly ops: readonly Op[];
  readonly context: Context;
};

export default class CommittedWatch<
  T = committedStateSourceTypes.ObservedDocumentValue,
> implements typesModule.WatchHandle<T> {
  readonly #detach: () => void;
  readonly #report: (error: unknown) => void;
  readonly #replace: (() => T) | undefined;
  readonly #closed = Promise.withResolvers<typesModule.WatchEnd>();
  readonly #pending: WatchFrame<T>[] = [];
  #value: T;
  #listener: ((value: T, ops: readonly Op[], context: Context) => Promise<void>) | undefined;
  #started = false;
  #scheduled = false;
  #running = false;
  #retired = false;
  #end: typesModule.WatchEnd | undefined;
  #cancellationSignal: AbortSignal | undefined;
  #cancellationListener: (() => void) | undefined;

  constructor(value: T, detach: () => void, report: (error: unknown) => void, replace?: () => T) {
    this.#value = value;
    this.#detach = detach;
    this.#report = report;
    this.#replace = replace;
  }

  get value(): T {
    return this.#value;
  }

  get closed(): Promise<typesModule.WatchEnd> {
    return this.#closed.promise;
  }

  start(listener: (value: T, ops: readonly Op[], context: Context) => Promise<void>): void {
    if (this.#started) throw new Error("Watch is already started");
    if (this.#end !== undefined) throw new Error("Watch is stopped");
    this.#started = true;
    this.#listener = listener;
    if (this.#pending.length > 0) this.#schedule();
  }

  stop(): Promise<typesModule.WatchEnd> {
    this.#terminate({ reason: "stopped" });
    return this.#closed.promise;
  }

  observeCancellation(signal: AbortSignal): void {
    if (this.#cancellationSignal !== undefined)
      throw new Error("Watch cancellation is already installed");
    if (this.#end !== undefined) return;
    this.#cancellationSignal = signal;
    this.#cancellationListener = () => this.cancel();
    signal.addEventListener("abort", this.#cancellationListener, { once: true });
    if (signal.aborted) this.cancel();
  }

  cancel(): void {
    this.#terminate({ reason: "cancelled" });
  }

  closeSession(failure?: { readonly error: unknown }): void {
    this.#terminate(
      failure === undefined
        ? { reason: "session_closed" }
        : { error: failure.error, reason: "session_failed" },
    );
  }

  advance(value: T, ops: readonly Op[], context: Context): void {
    if (this.#end !== undefined || this.#retired) return;
    if (value === null) this.#retired = true;
    if (this.#pending.length >= MAX_PENDING_WATCH_FRAMES) {
      this.#pending.length = 0;
      const replacement = this.#replace?.() ?? value;
      this.#pending.push({ context, ops: [["r", replacement as JsonValue]], value: replacement });
    } else {
      this.#pending.push({ context, ops, value });
    }
    if (this.#started) this.#schedule();
  }

  #schedule(): void {
    if (this.#scheduled || this.#running || this.#end !== undefined) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      void this.#drain();
    });
  }

  #drain(): Promise<void> {
    if (this.#running || this.#end !== undefined || !this.#started) return Promise.resolve();
    this.#running = true;
    return Effect.runPromise(
      this.#deliverPending().pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.#running = false;
            if (this.#end === undefined && this.#pending.length > 0) this.#schedule();
          }),
        ),
      ),
    );
  }

  #deliverPending(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      while (this.#end === undefined) {
        const frame = this.#pending.shift();
        if (frame === undefined) return;
        const delivered = yield* Effect.exit(this.#deliver(frame));
        if (Exit.isFailure(delivered)) {
          this.#listenerFailed(Cause.squash(delivered.cause));
          return;
        }
        if (frame.value === null) {
          this.#terminate({ reason: "retired" });
          return;
        }
      }
    });
  }

  #deliver(frame: WatchFrame<T>): Effect.Effect<void> {
    this.#value = frame.value;
    const deliveryContext = withoutAbortSignal(frame.context);
    const listener = this.#listener!;
    return Effect.promise(() => Promise.resolve(listener(frame.value, frame.ops, deliveryContext)));
  }

  #listenerFailed(error: unknown): void {
    if (this.#end !== undefined) return;
    this.#report(error);
    this.#terminate({ error: toError(error), reason: "listener_error" });
  }

  #terminate(end: typesModule.WatchEnd): void {
    if (this.#end !== undefined) return;
    this.#end = end;
    this.#detach();
    this.#pending.length = 0;
    if (this.#cancellationListener !== undefined) {
      this.#cancellationSignal?.removeEventListener("abort", this.#cancellationListener);
    }
    this.#closed.resolve(end);
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(errorMessage(error));
}

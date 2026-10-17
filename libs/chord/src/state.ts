import { dual } from "effect/Function";

import { BACKGROUND_CONTEXT, type Context } from "./context/index.ts";
import { type Draft, type Op, type Prepared, type Tracker, track } from "./delta/index.ts";

export interface ReplicatedStateDelivery {
  readonly kind: "hydrate" | "update";
  readonly sequence: number;
}

export interface ReplicatedState<T> {
  readonly value: T | undefined;
  subscribe(
    listener: (value: T, context: Context, delivery: ReplicatedStateDelivery) => Promise<void>,
  ): () => void;
  subscribe(
    listener: (value: T, context: Context, delivery: ReplicatedStateDelivery) => void,
  ): () => void;
}

export interface MutableReplicatedState<T extends object> extends ReplicatedState<T> {
  readonly value: T;
  change(context: Context, mutate: (draft: Draft<T>) => void): void;
  replace(context: Context, value: T): void;
}

export interface ReplicatedStateSourceFrame<T> {
  readonly cursor: number;
  readonly value: T;
  readonly ops: readonly Op[];
  readonly context: Context;
}

export interface ReplicatedStateSourceAttachment<T> {
  readonly snapshot: { readonly value: T; readonly cursor: number };
  activate(listener: (frame: ReplicatedStateSourceFrame<T>) => void): void;
  dispose(): void;
}

export interface ReplicatedStateSource<T> {
  attach(): ReplicatedStateSourceAttachment<T>;
}

export interface ReplicatedStateSourceOptions {
  readonly onError?: (error: Error) => void;
}

export interface AttachedReplicatedState<T> extends ReplicatedState<T> {
  readonly value: T;
  dispose(): void;
}

type StateListener<T> = (value: T, context: Context, delivery: ReplicatedStateDelivery) => void;

type StateDelivery<T> = {
  readonly value: T;
  readonly context: Context;
  readonly delivery: ReplicatedStateDelivery;
};

class StateSubscriber<T> {
  readonly #listener: StateListener<T>;
  readonly #reportError: (error: Error) => void;
  readonly #pending: StateDelivery<T>[] = [];
  #running = false;
  #started = false;
  #closed = false;

  constructor(listener: StateListener<T>, reportError: (error: Error) => void) {
    this.#listener = listener;
    this.#reportError = reportError;
  }

  push(frame: StateDelivery<T>): void {
    if (this.#closed) return;
    if (this.#pending.length === 100) {
      const hydration = this.#started ? undefined : this.#pending[0];
      this.#pending.length = 0;
      if (hydration !== undefined) this.#pending.push(hydration);
    }
    this.#pending.push(frame);
  }

  drain(): void {
    if (this.#running || this.#closed) return;
    this.#running = true;
    for (let frame = this.#pending.shift(); frame !== undefined; frame = this.#pending.shift()) {
      this.#started = true;
      try {
        const result: unknown = this.#listener(frame.value, frame.context, frame.delivery);
        if (isPromiseLike(result)) {
          void Promise.resolve(result).then(
            () => this.#resume(),
            (error: unknown) => {
              this.#report(error);
              this.#resume();
            },
          );
          return;
        }
      } catch (error) {
        this.#report(error);
      }
    }
    this.#running = false;
  }

  clear(): void {
    this.#pending.length = 0;
  }

  close(): void {
    this.#closed = true;
    this.clear();
  }

  #resume(): void {
    this.#running = false;
    this.drain();
  }

  #report(error: unknown): void {
    try {
      this.#reportError(toError(error));
    } catch (reportError) {
      reportErrorAsync(toError(reportError));
    }
  }
}

type Publication<T> = {
  readonly value: T;
  readonly sequence: number;
  readonly context: Context;
};

class ReplicatedStatePublisher<T> {
  readonly #listeners = new Map<StateSubscriber<T>, number>();
  readonly #reportError: (error: Error) => void;
  readonly #publications: Publication<T>[] = [];
  #value: T;
  #sequence = 0;
  #delivering = false;

  constructor(initial: T, reportError: (error: Error) => void = reportErrorAsync) {
    this.#value = initial;
    this.#reportError = reportError;
  }

  get value(): T {
    return this.#value;
  }

  snapshot(): { readonly value: T; readonly sequence: number } {
    return { value: this.#value, sequence: this.#sequence };
  }

  subscribe(listener: StateListener<T>): () => void {
    const { value, sequence } = this.snapshot();
    const subscriber = new StateSubscriber(listener, this.#reportError);
    this.#listeners.set(subscriber, sequence);
    subscriber.push({
      value,
      context: BACKGROUND_CONTEXT,
      delivery: { kind: "hydrate", sequence },
    });
    subscriber.drain();
    return () => {
      subscriber.close();
      this.#listeners.delete(subscriber);
    };
  }

  publish(value: T, context: Context): void {
    this.#value = value;
    this.#sequence += 1;
    this.#publications.push({ value, sequence: this.#sequence, context });
    if (this.#delivering) return;

    this.#delivering = true;
    try {
      for (
        let publication = this.#publications.shift();
        publication !== undefined;
        publication = this.#publications.shift()
      ) {
        const delivery = { kind: "update", sequence: publication.sequence } as const;
        for (const [subscriber, hydratedSequence] of [...this.#listeners]) {
          if (publication.sequence <= hydratedSequence) continue;
          subscriber.push({ value: publication.value, context: publication.context, delivery });
          subscriber.drain();
        }
      }
    } finally {
      this.#delivering = false;
    }
  }
}

class MutableReplicatedStateImpl<T extends object> implements MutableReplicatedState<T> {
  readonly #tracker: Tracker<T>;
  readonly #publisher: ReplicatedStatePublisher<T>;
  #changing = false;

  constructor(initial: T) {
    this.#tracker = track(initial);
    this.#publisher = new ReplicatedStatePublisher(this.#tracker.value);
  }

  get value(): T {
    return this.#tracker.value;
  }

  change(context: Context, mutate: Parameters<MutableReplicatedState<T>["change"]>[1]): void {
    if (this.#changing)
      throw new Error("Replicated state cannot be changed reentrantly from a change callback");
    this.#changing = true;
    let prepared: Prepared<T>;
    try {
      const change = this.#tracker.beginChange();
      try {
        const outcome = (mutate as (draft: typeof change.state) => unknown)(change.state);
        if (isPromiseLike(outcome)) {
          void Promise.resolve(outcome).catch(() => undefined);
          throw new TypeError("Replicated state change callbacks must be synchronous");
        }
        prepared = change.prepare();
      } catch (error) {
        change.abort();
        throw error;
      }
    } finally {
      this.#changing = false;
    }

    this.#tracker.adopt(prepared);
    if (prepared.ops.length > 0) this.#publisher.publish(prepared.value, context);
  }

  replace(context: Context, value: T): void {
    if (this.#changing)
      throw new Error("Replicated state cannot be replaced from a change callback");
    const prepared = this.#tracker.prepareReplace(value);
    this.#tracker.adopt(prepared);
    if (prepared.ops.length > 0) this.#publisher.publish(prepared.value, context);
  }

  subscribe(listener: StateListener<T>): () => void {
    return this.#publisher.subscribe(listener);
  }
}

class AttachedReplicatedStateImpl<T> implements AttachedReplicatedState<T> {
  readonly #publisher: ReplicatedStatePublisher<T>;
  readonly #attachment: ReplicatedStateSourceAttachment<T>;
  readonly #reportError: (error: Error) => void;
  #cursor: number;
  #disposed = false;

  constructor(
    attachment: ReplicatedStateSourceAttachment<T>,
    options: ReplicatedStateSourceOptions,
  ) {
    const { snapshot } = attachment;
    assertCursor(snapshot.cursor, "snapshot");
    this.#attachment = attachment;
    this.#cursor = snapshot.cursor;
    this.#reportError = options.onError ?? reportErrorAsync;
    this.#publisher = new ReplicatedStatePublisher(snapshot.value, (error) => this.#report(error));
  }

  get value(): T {
    return this.#publisher.value;
  }

  subscribe(listener: StateListener<T>): () => void {
    return this.#publisher.subscribe(listener);
  }

  activate(): void {
    this.#attachment.activate((frame) => this.#receive(frame));
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#attachment.dispose();
  }

  #receive(frame: ReplicatedStateSourceFrame<T>): void {
    if (this.#disposed) return;
    try {
      assertCursor(frame.cursor, "frame");
      const expected = this.#cursor + 1;
      if (frame.cursor !== expected) {
        throw new Error(
          `Replicated state source cursor has a gap: expected ${expected}, received ${frame.cursor}`,
        );
      }
      this.#cursor = frame.cursor;
      this.#publisher.publish(frame.value, frame.context);
    } catch (error) {
      this.#fail(toError(error));
    }
  }

  #fail(error: Error): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.#attachment.dispose();
    } catch (disposeError) {
      this.#report(
        new AggregateError([error, disposeError], "Replicated state source contract failed"),
      );
      return;
    }
    this.#report(error);
  }

  #report(error: unknown): void {
    try {
      this.#reportError(toError(error));
    } catch (reportError) {
      reportErrorAsync(toError(reportError));
    }
  }
}

function attachReplicatedStateSource<T>(
  source: ReplicatedStateSource<T>,
  options: ReplicatedStateSourceOptions = {},
): AttachedReplicatedState<T> {
  const attachment = source.attach();
  try {
    const state = new AttachedReplicatedStateImpl(attachment, options);
    state.activate();
    return state;
  } catch (error) {
    try {
      attachment.dispose();
    } catch (disposeError) {
      throw new AggregateError([error, disposeError], "Failed to attach replicated state source", {
        cause: disposeError,
      });
    }
    throw error;
  }
}

function assertCursor(cursor: number, kind: "snapshot" | "frame"): void {
  if (!Number.isSafeInteger(cursor))
    throw new TypeError(`Replicated state source ${kind} cursor must be a safe integer`);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === "object" && value !== null) || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function reportErrorAsync(error: Error): void {
  queueMicrotask(() => {
    throw error;
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function stateReplicated(
  initialOrSource: object | ReplicatedStateSource<unknown>,
  options?: ReplicatedStateSourceOptions,
): MutableReplicatedState<object> | AttachedReplicatedState<unknown> {
  if (isReplicatedStateSource(initialOrSource))
    return attachReplicatedStateSource(initialOrSource, options);
  return new MutableReplicatedStateImpl(initialOrSource);
}

function isReplicatedStateSource(value: object): value is ReplicatedStateSource<unknown> {
  return typeof (value as { readonly attach?: unknown }).attach === "function";
}

export const replicatedState: {
  <T>(
    source: ReplicatedStateSource<T>,
    options?: ReplicatedStateSourceOptions,
  ): AttachedReplicatedState<T>;
  <T extends object>(initial: T): MutableReplicatedState<T>;
  (
    options?: ReplicatedStateSourceOptions,
  ): <T>(source: ReplicatedStateSource<T>) => AttachedReplicatedState<T>;
} = dual((args) => args.length >= 1, stateReplicated);

import { Effect } from "effect";

import { HYDRATION, type Hydration, hydrationOf, notReady } from "./cell.ts";
import { ChordError } from "./errors.ts";
import { enqueue } from "./publish.ts";
import type { RefImpl } from "./ref.ts";
import { isStateLike, variantOf } from "./service.ts";
import type { Readable, StateEvent } from "./types.ts";

const noop = (): void => {};

export class MemberReadable implements Readable<unknown> {
  readonly #ref: RefImpl;
  readonly #name: string;
  readonly #values = new Set<(value: unknown) => void>();
  readonly #events = new Set<(event: StateEvent<unknown>) => void>();
  readonly #unseen = new Set<(event: StateEvent<unknown>) => void>();
  #source: Readable<unknown> | undefined;
  #upstream = noop;
  #seen: { readonly value: unknown } | undefined;

  constructor(ref: RefImpl, name: string) {
    this.#ref = ref;
    this.#name = name;
  }

  get value(): unknown {
    const ref = this.#ref;
    if (ref.status === "released" || ref.status === "gone") throw ref.terminalError();
    if (ref.status !== "live") throw notReady(`${ref.address}.${this.#name}`);
    const view = ref.currentView();
    if (view === undefined) throw notReady(`${ref.address}.${this.#name}`);
    const source = this.#current();
    if (source === undefined) {
      throw new ChordError(
        "not_in_variant",
        `${ref.address}: ${this.#name} is not a state member of variant ${variantOf(view) ?? "(local)"}`,
      );
    }
    return source.value;
  }

  get [HYDRATION](): Hydration | undefined {
    const ref = this.#ref;
    if (ref.status === "live") return hydrationOf(this.#current());
    return {
      hydrated: false,
      whenHydrated: () =>
        Effect.runPromise(
          Effect.gen({ self: this }, function* () {
            yield* Effect.promise(() => ref.ready);
            yield* Effect.promise(() =>
              Promise.resolve(hydrationOf(this.#current())?.whenHydrated()),
            );
          }),
        ),
    };
  }

  subscribe(listener: (value: unknown) => void): () => void {
    this.#values.add(listener);
    const source = this.#readable();
    if (source !== undefined) {
      this.#seen = { value: source.value };
      this.#safe(() => listener(source.value));
    }
    this.bind();
    return () => this.#remove(this.#values, listener);
  }

  events(listener: (event: StateEvent<unknown>) => void): () => void {
    this.#events.add(listener);
    const source = this.#readable();
    if (source === undefined) this.#unseen.add(listener);
    else {
      const value = source.value;
      this.#seen = { value };
      this.#safe(() => listener({ type: "snap", value }));
    }
    this.bind();
    return () => {
      this.#unseen.delete(listener);
      this.#remove(this.#events, listener);
    };
  }

  bind(): void {
    const source = this.#values.size + this.#events.size > 0 ? this.#current() : undefined;
    if (source === this.#source) return;
    this.#upstream();
    this.#upstream = noop;
    this.#source = source;
    if (source === undefined) return;
    let first = true;
    this.#upstream = source.events((event) => {
      const isFirst = first;
      first = false;
      if (
        isFirst &&
        this.#unseen.size === 0 &&
        this.#seen !== undefined &&
        event.value === this.#seen.value
      )
        return;
      this.#seen = { value: event.value };
      const translated: StateEvent<unknown> = isFirst
        ? { type: "reset", value: event.value }
        : event;
      const events = [...this.#events];
      const values = [...this.#values];
      const unseen = new Set(this.#unseen);
      this.#unseen.clear();
      enqueue(() => {
        for (const listener of events) {
          if (!this.#events.has(listener)) continue;
          const delivered: StateEvent<unknown> = unseen.has(listener)
            ? { type: "snap", value: event.value }
            : translated;
          this.#safe(() => listener(delivered));
        }
        for (const listener of values)
          if (this.#values.has(listener)) this.#safe(() => listener(event.value));
      });
    });
  }

  stop(): void {
    this.#values.clear();
    this.#events.clear();
    this.#unseen.clear();
    this.bind();
  }

  #current(): Readable<unknown> | undefined {
    const view = this.#ref.currentView();
    if (view === undefined || !this.#ref.inVariant(view, this.#name)) return undefined;
    const value = view[this.#name];
    return isStateLike(value) ? (value as Readable<unknown>) : undefined;
  }

  #readable(): Readable<unknown> | undefined {
    const source = this.#current();
    return source === undefined || hydrationOf(source)?.hydrated === false ? undefined : source;
  }

  #remove<T>(set: Set<T>, listener: T): void {
    set.delete(listener);
    this.bind();
  }

  #safe(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.#ref.object.host.report(error);
    }
  }
}

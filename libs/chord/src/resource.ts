import { Effect, Exit } from "effect";

import { notReady } from "./cell.ts";
import type { RefCore } from "./core.ts";
import type { Resource, ResourceDeclaration } from "./declare.ts";
import { ChordError } from "./errors.ts";

export const facades = new WeakMap<object, ResourceImpl>();

export class ResourceImpl<T = unknown> implements Resource<T> {
  readonly key: string;
  spec: ResourceDeclaration<T>;
  readonly deps: readonly (RefCore | ResourceImpl)[];
  state: "closed" | "opening" | "open" | "unavailable" = "closed";
  #value: T | undefined;

  constructor(
    key: string,
    spec: ResourceDeclaration<T>,
    deps: readonly (RefCore | ResourceImpl)[],
  ) {
    this.key = key;
    this.spec = spec;
    this.deps = deps;
  }

  get value(): T {
    if (this.state === "unavailable")
      throw new ChordError("unavailable", `resource ${this.key} could not be restored`);
    if (this.state !== "open") throw notReady(`resource ${this.key}`);
    return this.#value as T;
  }

  get exclusive(): boolean {
    return this.spec.exclusive === true;
  }

  open(signal: AbortSignal, order: ResourceImpl[]): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (this.state !== "closed") return;
      this.state = "opening";
      const opened = yield* Effect.exit(
        Effect.promise(() => Promise.resolve(this.spec.open({ signal }))),
      );
      if (Exit.isFailure(opened)) this.state = "closed";
      const value = yield* opened;
      if (signal.aborted) {
        this.state = "closed";
        yield* Effect.promise(() => Promise.resolve(this.spec.close?.(value)));
        throw new ChordError("aborted", `resource ${this.key} opened after abort`);
      }
      this.#value = value;
      this.state = "open";
      order.push(this);
    });
  }

  close(order: ResourceImpl[]): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (this.state !== "open") return;
      this.state = "closed";
      const index = order.indexOf(this);
      if (index !== -1) order.splice(index, 1);
      const value = this.#value as T;
      this.#value = undefined;
      yield* Effect.promise(() => Promise.resolve(this.spec.close?.(value)));
    });
  }

  markUnavailable(): void {
    this.state = "unavailable";
    this.#value = undefined;
  }

  adopt(spec: ResourceDeclaration<T>): void {
    this.spec = spec;
  }
}

export const resourceOf = (value: unknown): ResourceImpl | undefined =>
  value instanceof ResourceImpl
    ? value
    : value !== null && typeof value === "object"
      ? facades.get(value)
      : undefined;

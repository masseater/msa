import { Effect, Exit } from "effect";

import cell from "./cell.ts";
import type coreTypes from "./core.types.ts";
import type declareTypes from "./declare.ts";
import errorsModule from "./errors.ts";

const { ChordError } = errorsModule;
const { notReady } = cell;

export default class ResourceImpl<T = unknown> implements declareTypes.Resource<T> {
  readonly key: string;
  spec: declareTypes.ResourceDeclaration<T>;
  readonly deps: readonly (coreTypes.RefCore | ResourceImpl)[];
  state: "closed" | "opening" | "open" | "unavailable" = "closed";
  #value: T | undefined;

  constructor(
    key: string,
    spec: declareTypes.ResourceDeclaration<T>,
    deps: readonly (coreTypes.RefCore | ResourceImpl)[],
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

  adopt(spec: declareTypes.ResourceDeclaration<T>): void {
    this.spec = spec;
  }
}

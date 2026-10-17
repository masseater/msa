import { BaseContext } from "./base.ts";
import type { Context, ContextKey } from "./types.ts";

export class ContextValue<T> extends BaseContext {
  readonly #parent: Context;
  readonly #key: ContextKey<T>;
  readonly #value: T;

  constructor(parent: Context, key: ContextKey<T>, value: T) {
    super();
    this.#parent = parent;
    this.#key = key;
    this.#value = value;
  }

  value<Value>(key: ContextKey<Value>): Value | undefined {
    if (key.token === this.#key.token) return this.#value as unknown as Value;
    return this.#parent.value(key);
  }

  toString(): string {
    return `${this.#parent}.WithValue(${this.#key.token.description ?? "anonymous"})`;
  }
}

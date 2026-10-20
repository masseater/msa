import BaseContext from "./base.ts";
import type typesModule from "./types.types.ts";

export default class ContextValue<T> extends BaseContext {
  readonly #parent: typesModule.Context;
  readonly #key: typesModule.ContextKey<T>;
  readonly #value: T;

  constructor(parent: typesModule.Context, key: typesModule.ContextKey<T>, value: T) {
    super();
    this.#parent = parent;
    this.#key = key;
    this.#value = value;
  }

  value<Value>(key: typesModule.ContextKey<Value>): Value | undefined {
    if (key.token === this.#key.token) return this.#value as unknown as Value;
    return this.#parent.value(key);
  }

  toString(): string {
    return `${this.#parent}.WithValue(${this.#key.token.description ?? "anonymous"})`;
  }
}

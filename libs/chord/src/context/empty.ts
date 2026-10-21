import BaseContext from "./base.ts";
import type typesModule from "./types.types.ts";

export default class EmptyContext extends BaseContext {
  readonly #name: string;

  constructor(name: string) {
    super();
    this.#name = name;
  }

  value<T>(_key: typesModule.ContextKey<T>): T | undefined {
    return undefined;
  }

  toString(): string {
    return this.#name;
  }
}

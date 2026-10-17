import { BaseContext } from "./base.ts";
import type { ContextKey } from "./types.ts";

export class EmptyContext extends BaseContext {
  readonly #name: string;

  constructor(name: string) {
    super();
    this.#name = name;
  }

  value<T>(_key: ContextKey<T>): T | undefined {
    return undefined;
  }

  toString(): string {
    return this.#name;
  }
}

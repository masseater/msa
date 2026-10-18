import type { Context, ContextKey } from "./types.ts";
import { ABORT_SIGNAL_CONTEXT_KEY } from "./types.ts";

export abstract class BaseContext implements Context {
  abstract value<T>(key: ContextKey<T>): T | undefined;
  abstract toString(): string;

  get abortSignal(): AbortSignal | undefined {
    return this.value(ABORT_SIGNAL_CONTEXT_KEY);
  }
}

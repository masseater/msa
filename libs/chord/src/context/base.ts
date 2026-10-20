import types from "./types.ts";
import type typesModule from "./types.types.ts";

const { ABORT_SIGNAL_CONTEXT_KEY } = types;

export default abstract class BaseContext implements typesModule.Context {
  abstract value<T>(key: typesModule.ContextKey<T>): T | undefined;
  abstract toString(): string;

  get abortSignal(): AbortSignal | undefined {
    return this.value(ABORT_SIGNAL_CONTEXT_KEY);
  }
}

export interface ContextKey<T> {
  readonly token: symbol;
  readonly valueType?: (value: T) => T;
}

export interface Context {
  readonly abortSignal: AbortSignal | undefined;
  value<T>(key: ContextKey<T>): T | undefined;
  toString(): string;
}

export const ABORT_SIGNAL_CONTEXT_KEY: ContextKey<AbortSignal | undefined> = Object.freeze({
  token: Symbol("chord.abortSignal"),
});

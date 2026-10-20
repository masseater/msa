declare namespace contextTypes {
  interface ContextKey<T> {
    readonly token: symbol;
    readonly valueType?: (value: T) => T;
  }

  interface Context {
    readonly abortSignal: AbortSignal | undefined;
    value<T>(key: ContextKey<T>): T | undefined;
    toString(): string;
  }
}

export type { contextTypes as default };

declare namespace typeSupportTypes {
  type Signatures<F> = F extends {
    (...args: infer A1): unknown;
    (...args: infer A2): unknown;
    (...args: infer A3): unknown;
    (...args: infer A4): unknown;
    (...args: infer A5): unknown;
    (...args: infer A6): unknown;
    (...args: infer A7): unknown;
    (...args: infer A8): unknown;
  }
    ? A1 | A2 | A3 | A4 | A5 | A6 | A7 | A8
    : never;

  type AcceptedBy<P, Args> = P extends readonly unknown[] ? (Args extends P ? true : false) : never;

  type CallableWith<F, Args extends readonly unknown[]> =
    true extends AcceptedBy<Signatures<F>, Args> ? true : false;

  type Nested<T> = T extends readonly unknown[]
    ? false
    : T extends (...args: never) => unknown
      ? false
      : T extends object
        ? true
        : false;

  type FieldsFit<T, U> = {
    [K in keyof T & keyof U]: Nested<T[K]> extends true ? LiteralFits<T[K], U[K]> : true;
  }[keyof T & keyof U];

  type Fits<T, U> = U extends unknown
    ? [T] extends [U]
      ? [Exclude<keyof T, keyof U>] extends [never]
        ? false extends FieldsFit<T, U>
          ? false
          : true
        : false
      : false
    : never;

  type LiteralFits<T, U> = true extends Fits<T, U> ? true : false;
}

export type { typeSupportTypes as default };

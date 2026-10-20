declare namespace dualTypes {
  type Dual2<A, B, R> = {
    (b: B): (a: A) => R;
    (a: A, b: B): R;
  };

  type Dual3<A, B, C, R> = {
    (b: B, c: C): (a: A) => R;
    (a: A, b: B, c: C): R;
  };

  type Dual4<A, B, C, D, R> = {
    (b: B, c: C, d: D): (a: A) => R;
    (a: A, b: B, c: C, d: D): R;
  };

  type Dual5<A, B, C, D, E, R> = {
    (b: B, c: C, d: D, e: E): (a: A) => R;
    (a: A, b: B, c: C, d: D, e: E): R;
  };
}

export type { dualTypes as default };

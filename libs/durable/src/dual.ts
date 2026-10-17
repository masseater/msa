export type Dual2<A, B, R> = {
  (b: B): (a: A) => R;
  (a: A, b: B): R;
};

export type Dual3<A, B, C, R> = {
  (b: B, c: C): (a: A) => R;
  (a: A, b: B, c: C): R;
};

export type Dual4<A, B, C, D, R> = {
  (b: B, c: C, d: D): (a: A) => R;
  (a: A, b: B, c: C, d: D): R;
};

export type Dual5<A, B, C, D, E, R> = {
  (b: B, c: C, d: D, e: E): (a: A) => R;
  (a: A, b: B, c: C, d: D, e: E): R;
};

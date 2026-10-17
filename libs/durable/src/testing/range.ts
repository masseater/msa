import { Function } from "effect";

import type { Dual2, Dual3 } from "../dual.ts";

const steps = function* (start: number, end: number, step: number): Generator<number> {
  for (let value = start; value < end; value += step) yield value;
};

export const rangeBy: Dual3<number, number, number, Generator<number>> = Function.dual(3, steps);

export const range: Dual2<number, number, Generator<number>> = Function.dual(
  2,
  (start: number, end: number): Generator<number> => steps(start, end, 1),
);

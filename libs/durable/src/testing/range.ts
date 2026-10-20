import { Function } from "effect";

import type dualTypes from "../dual.ts";

const steps = function* (start: number, end: number, step: number): Generator<number> {
  for (let value = start; value < end; value += step) yield value;
};

const rangeBy: dualTypes.Dual3<number, number, number, Generator<number>> = Function.dual(3, steps);

const range: dualTypes.Dual2<number, number, Generator<number>> = Function.dual(
  2,
  (start: number, end: number): Generator<number> => steps(start, end, 1),
);

const rangeModule = {
  range,
  rangeBy,
};

export default rangeModule;

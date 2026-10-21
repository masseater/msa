import { Effect, Function } from "effect";

const eachFrom = <T>(
  items: readonly T[],
  step: (item: T) => Effect.Effect<void>,
  from: number,
): Effect.Effect<void> => {
  for (let index = from; index < items.length; index++) {
    const pending = step(items[index]!);
    if (pending !== Effect.void) {
      return Effect.flatMap(pending, () => eachFrom(items, step, index + 1));
    }
  }
  return Effect.void;
};

const eachStep: {
  <T>(step: (item: T) => Effect.Effect<void>): (items: readonly T[]) => Effect.Effect<void>;
  <T>(items: readonly T[], step: (item: T) => Effect.Effect<void>): Effect.Effect<void>;
} = Function.dual(
  2,
  <T>(items: readonly T[], step: (item: T) => Effect.Effect<void>): Effect.Effect<void> =>
    eachFrom(items, step, 0),
);

const thenStep: {
  <A>(next: () => Effect.Effect<A>): (first: Effect.Effect<void>) => Effect.Effect<A>;
  <A>(first: Effect.Effect<void>, next: () => Effect.Effect<A>): Effect.Effect<A>;
} = Function.dual(
  2,
  <A>(first: Effect.Effect<void>, next: () => Effect.Effect<A>): Effect.Effect<A> =>
    first === Effect.void ? next() : Effect.flatMap(first, next),
);

const settleStep: {
  <A>(value: () => A): (pending: Effect.Effect<void>) => A | Promise<A>;
  <A>(pending: Effect.Effect<void>, value: () => A): A | Promise<A>;
} = Function.dual(2, <A>(pending: Effect.Effect<void>, value: () => A): A | Promise<A> =>
  pending === Effect.void ? value() : Effect.runPromise(Effect.map(pending, value)),
);

const stepModule = {
  eachStep,
  settleStep,
  thenStep,
};

export default stepModule;

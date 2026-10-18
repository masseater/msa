import { Effect, Predicate } from "effect";

export const call = <A>(evaluate: () => A | PromiseLike<A>): Effect.Effect<A> =>
  Effect.suspend(() => {
    const value = evaluate();
    return Predicate.isPromiseLike(value)
      ? Effect.promise(() => Promise.resolve(value as PromiseLike<A>))
      : Effect.succeed(value);
  });

export const now = (): number =>
  Effect.runSync(Effect.clockWith((clock) => clock.currentTimeMillis));

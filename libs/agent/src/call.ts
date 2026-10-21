import { Effect, Predicate } from "effect";

const call = <A>(evaluate: () => A | PromiseLike<A>): Effect.Effect<A> =>
  Effect.suspend(() => {
    const value = evaluate();
    return Predicate.isPromiseLike(value)
      ? Effect.promise(() => Promise.resolve(value as PromiseLike<A>))
      : Effect.succeed(value);
  });

const now = (): number => Effect.runSync(Effect.clockWith((clock) => clock.currentTimeMillis));

const callModule = {
  call,
  now,
};

export default callModule;

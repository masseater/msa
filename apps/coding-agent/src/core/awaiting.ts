import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { dual } from "effect/Function";

type Steps<A> = Generator<Effect.Effect<unknown, never, never>, A, any>;

function* awaited<A>(value: A | PromiseLike<A>): Steps<Awaited<A>> {
  return (yield Effect.promise(() => Promise.resolve(value))) as Awaited<A>;
}

function* performed<A>(effect: Effect.Effect<A>): Steps<A> {
  return (yield effect) as A;
}

const drive = <A>(start: () => Steps<A>): Effect.Effect<A> =>
  Effect.gen(function* () {
    const steps = start();
    let step = steps.next();
    while (step.done !== true) {
      const exit = yield* Effect.exit(step.value);
      if (Exit.isSuccess(exit)) {
        step = steps.next(exit.value);
      } else if (Cause.hasInterruptsOnly(exit.cause)) {
        return yield* Effect.failCause(exit.cause as Cause.Cause<never>);
      } else {
        step = steps.throw(Cause.squash(exit.cause));
      }
    }
    return step.value;
  });

const awaiting = <A>(body: () => Steps<A>): Effect.Effect<A> => drive(body);

const awaitingWith: {
  <This>(self: This): <A>(body: (this: This) => Steps<A>) => Effect.Effect<A>;
  <This, A>(body: (this: This) => Steps<A>, self: This): Effect.Effect<A>;
} = dual(2, <This, A>(body: (this: This) => Steps<A>, self: This): Effect.Effect<A> =>
  drive(() => body.call(self)),
);

const awaitingModule = {
  awaited,
  awaiting,
  awaitingWith,
  performed,
};

export default awaitingModule;

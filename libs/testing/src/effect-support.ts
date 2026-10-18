import {
  Cause,
  Clock,
  Context,
  Crypto,
  DateTime,
  Deferred,
  type Duration,
  Effect,
  Exit,
} from "effect";

import { provideNode, testRuntime } from "./runtime.ts";

const clock = Context.get(Context.empty(), Clock.Clock);

export const currentTimeMillis = (): number => clock.currentTimeMillisUnsafe();

export const nowIso = (): string => DateTime.formatIso(DateTime.makeUnsafe(currentTimeMillis()));

export const awaited = <A>(value: A | PromiseLike<A>): Effect.Effect<A> =>
  Effect.promise(() => Promise.resolve(value));

export const failure = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<unknown> =>
  Effect.exit(effect).pipe(
    Effect.flatMap((exit) =>
      Exit.isSuccess(exit)
        ? Effect.die(new Error("Expected the effect to fail"))
        : Effect.succeed(Cause.squash(exit.cause)),
    ),
  );

export const abortController = (): AbortController => new AbortController();

export const pollUntil = Effect.fn("pollUntil")(function* (
  check: Effect.Effect<boolean>,
  attempts: number,
  interval: Duration.Input,
) {
  for (let attempt = 0; !(yield* check); attempt++) {
    if (attempt >= attempts) throw new Error("Condition was not reached");
    yield* Effect.sleep(interval);
  }
});

export const randomSuffix: Effect.Effect<string> = provideNode(
  Crypto.Crypto.use((crypto) => crypto.randomUUIDv4),
).pipe(
  Effect.orDie,
  Effect.map((uuid) => uuid.replaceAll("-", "").slice(0, 12)),
);

export interface Gate extends Promise<void> {
  readonly release: () => void;
}

export const gate = (): Gate => {
  const deferred = Deferred.makeUnsafe<void>();
  const promise = testRuntime.runPromise(Deferred.await(deferred));
  return Object.assign(promise, {
    release: () => Deferred.doneUnsafe(deferred, Effect.void),
  });
};

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

import childProcesses from "./child-processes.ts";
import type effectSupportTypes from "./effect-support.types.ts";
import runtime from "./runtime.ts";

const { childProcessesRunning } = childProcesses;
const { provideNode, runTest, runTestSync } = runtime;

const clock = Context.get(Context.empty(), Clock.Clock);

const currentTimeMillis = (): number => clock.currentTimeMillisUnsafe();

const nowIso = (): string => DateTime.formatIso(DateTime.makeUnsafe(currentTimeMillis()));

const currentDate = (): Date => DateTime.toDate(DateTime.makeUnsafe(currentTimeMillis()));

const dateFromMillis = (value: string | number | Date): Date =>
  DateTime.toDate(DateTime.makeUnsafe(value));

const isoFromMillis = (value: string | number | Date): string =>
  DateTime.formatIso(DateTime.makeUnsafe(value));

const awaited = <A>(value: A | PromiseLike<A>): Effect.Effect<A> =>
  Effect.promise(() => Promise.resolve(value));

const failure = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<unknown> =>
  Effect.exit(effect).pipe(
    Effect.flatMap((exit) =>
      Exit.isSuccess(exit)
        ? Effect.die(new Error("Expected the effect to fail"))
        : Effect.succeed(Cause.squash(exit.cause)),
    ),
  );

const abortController = (): AbortController => new AbortController();

const deferredPromise = <A>(): effectSupportTypes.DeferredPromise<A> => {
  const deferred = Deferred.makeUnsafe<A>();
  return {
    promise: Deferred.await(deferred).pipe(Effect.runPromise),
    reject: (error) => {
      Deferred.doneUnsafe(deferred, Effect.die(error));
    },
    resolve: (value) => {
      Deferred.doneUnsafe(deferred, Effect.succeed(value));
    },
  };
};

const neverPromise = <A = never>(): Promise<A> => Effect.runPromise(Effect.never);

const sleep = (duration: Duration.Input): Effect.Effect<void> => Effect.sleep(duration);

const pollUntil = Effect.fn("pollUntil")(function* (
  check: Effect.Effect<boolean>,
  attempts: number,
  interval: Duration.Input | Effect.Effect<void>,
) {
  const step = Effect.isEffect(interval) ? interval : Effect.sleep(interval);
  let idle = 0;
  while (!(yield* check)) {
    if (!childProcessesRunning()) {
      if (idle >= attempts) throw new Error("Condition was not reached");
      idle += 1;
    }
    yield* step;
  }
});

const randomSuffix: Effect.Effect<string> = provideNode(
  Crypto.Crypto.use((crypto) => crypto.randomUUIDv4()),
).pipe(
  Effect.orDie,
  Effect.map((uuid) => uuid.replaceAll("-", "").slice(0, 12)),
);

const gate = (): effectSupportTypes.Gate => {
  const deferred = Deferred.makeUnsafe<void>();
  const promise = runTest(Deferred.await(deferred));
  return Object.assign(promise, {
    release: () => Deferred.doneUnsafe(deferred, Effect.void),
  });
};

const randomSuffixSync = (): string => runTestSync(randomSuffix);

const effectSupport = {
  abortController,
  awaited,
  currentDate,
  currentTimeMillis,
  dateFromMillis,
  deferredPromise,
  failure,
  gate,
  isoFromMillis,
  neverPromise,
  nowIso,
  pollUntil,
  randomSuffix,
  randomSuffixSync,
  sleep,
};

export default effectSupport;

import { Cause, type Duration, Effect, Exit, Schema } from "effect";

import { currentTimeMillis as currentTimeMillisModule } from "../src/clock.ts";

const awaited = <A>(value: A | PromiseLike<A>): Effect.Effect<A> =>
  Effect.promise(() => Promise.resolve(value));

const pollUntil = Effect.fn("pollUntil")(function* (
  check: Effect.Effect<boolean>,
  attempts: number,
  interval: Duration.Input,
) {
  for (let attempt = 0; !(yield* check); attempt++) {
    if (attempt >= attempts) throw new Error("Condition was not reached");
    yield* Effect.sleep(interval);
  }
});

const failure = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<unknown> =>
  Effect.exit(effect).pipe(
    Effect.flatMap((exit) =>
      Exit.isSuccess(exit)
        ? Effect.die(new Error("Expected the effect to fail"))
        : Effect.succeed(Cause.squash(exit.cause)),
    ),
  );

const abortController = (): AbortController => new AbortController();

const jsonText = Schema.fromJsonString(Schema.Unknown);
const encodeJsonText = Schema.encodeUnknownEffect(jsonText);
const decodeJsonText = Schema.decodeUnknownEffect(jsonText);

const toJsonText = (value: unknown): Effect.Effect<string> => Effect.orDie(encodeJsonText(value));

const fromJsonText = (text: string): Effect.Effect<unknown> => Effect.orDie(decodeJsonText(text));

const sampleEvery = Effect.fn("sampleEvery")(function* (
  interval: Duration.Input,
  sample: () => void,
) {
  return yield* Effect.forkChild(Effect.forever(Effect.delay(Effect.sync(sample), interval)));
});

const effectSupport = {
  abortController,
  awaited,
  currentTimeMillis: currentTimeMillisModule,
  failure,
  fromJsonText,
  pollUntil,
  sampleEvery,
  toJsonText,
};

export default effectSupport;

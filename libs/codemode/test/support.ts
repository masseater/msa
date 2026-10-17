import { Deferred, Effect, Schema } from "effect";

export const abortController = (): AbortController => new AbortController();

export const hang = (): Promise<never> => Effect.runPromise(Effect.never);

const UnknownJson = Schema.fromJsonString(Schema.Unknown);

export const toJson = (value: unknown): Effect.Effect<string> =>
  Schema.encodeEffect(UnknownJson)(value).pipe(Effect.orDie);

export const fromJson = (text: string): Effect.Effect<unknown> =>
  Schema.decodeEffect(UnknownJson)(text).pipe(Effect.orDie);

export interface Gate {
  readonly open: () => void;
  readonly opened: Effect.Effect<void>;
}

export function gate(): Gate {
  const deferred = Deferred.makeUnsafe<void>();
  return {
    open: () => {
      Deferred.doneUnsafe(deferred, Effect.void);
    },
    opened: Deferred.await(deferred),
  };
}

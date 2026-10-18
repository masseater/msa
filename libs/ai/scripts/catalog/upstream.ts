import { Cause, Console, Data, Effect } from "effect";

import { httpRequest } from "../../src/utils/http.ts";

export class UpstreamError extends Data.TaggedError("UpstreamError")<{
  readonly message: string;
}> {}

export interface UpstreamRequest {
  readonly url: string;
  readonly label: string;
}

export const fetchJson = Effect.fn("fetchJson")(function* ({ url, label }: UpstreamRequest) {
  const reply = yield* httpRequest({ url });
  if (!reply.ok) return yield* new UpstreamError({ message: `${label} returned ${reply.status}` });
  return yield* reply.json;
});

export interface UpstreamFallback<A> {
  readonly label: string;
  readonly strict: boolean;
  readonly fallback: () => A;
}

export const withFallback =
  <A>({ label, strict, fallback }: UpstreamFallback<A>) =>
  <E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.catchCause(effect, (cause) =>
      Effect.andThen(
        Console.error(`Failed to ${label}:`, Cause.pretty(cause)),
        strict ? Effect.failCause(cause) : Effect.sync(fallback),
      ),
    );

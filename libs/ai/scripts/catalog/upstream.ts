import { Cause, Console, Data, Effect } from "effect";

import http from "../../src/utils/http.ts";
import type upstreamTypes from "./upstream.types.ts";

const { httpRequest } = http;

class UpstreamError extends Data.TaggedError("UpstreamError")<{
  readonly message: string;
}> {}

const fetchJson = Effect.fn("fetchJson")(function* ({ url, label }: upstreamTypes.UpstreamRequest) {
  const reply = yield* httpRequest({ url });
  if (!reply.ok) return yield* new UpstreamError({ message: `${label} returned ${reply.status}` });
  return yield* reply.json;
});

const withFallback =
  <A>({ label, strict, fallback }: upstreamTypes.UpstreamFallback<A>) =>
  <E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.catchCause(effect, (cause) =>
      Effect.andThen(
        Console.error(`Failed to ${label}:`, Cause.pretty(cause)),
        strict ? Effect.failCause(cause) : Effect.sync(fallback),
      ),
    );

const upstream = {
  UpstreamError,
  fetchJson,
  withFallback,
};

export default upstream;

import { DateTime, Effect, Schema } from "effect";

import { tick } from "./timing.ts";

const Json = Schema.fromJsonString(Schema.Unknown);
const PrettyJson = Schema.fromJsonString(Schema.Unknown, { space: 2 });

export const decodeJson = (text: string): Effect.Effect<unknown> =>
  Effect.orDie(Schema.decodeEffect(Json)(text));

export const encodeJson = (value: unknown): Effect.Effect<string> =>
  Effect.orDie(Schema.encodeEffect(Json)(value));

export const encodePrettyJson = (value: unknown): Effect.Effect<string> =>
  Effect.orDie(Schema.encodeEffect(PrettyJson)(value));

export const nowIso: Effect.Effect<string> = Effect.map(DateTime.now, DateTime.formatIso);

export const collectGarbage = (rounds: number): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (global.gc === undefined) throw new Error("run with --expose-gc");
    for (let round = 0; round < rounds; round++) {
      yield* tick;
      global.gc();
    }
  });

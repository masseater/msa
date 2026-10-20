import { DateTime, Effect, Schema } from "effect";

import timing from "./timing.ts";

const { tick } = timing;

const Json = Schema.fromJsonString(Schema.Unknown);
const PrettyJson = Schema.fromJsonString(Schema.Unknown, { space: 2 });

const decodeJson = (text: string): Effect.Effect<unknown> =>
  Effect.orDie(Schema.decodeEffect(Json)(text));

const encodeJson = (value: unknown): Effect.Effect<string> =>
  Effect.orDie(Schema.encodeEffect(Json)(value));

const encodePrettyJson = (value: unknown): Effect.Effect<string> =>
  Effect.orDie(Schema.encodeEffect(PrettyJson)(value));

const nowIso: Effect.Effect<string> = Effect.map(DateTime.now, DateTime.formatIso);

const collectGarbage = (rounds: number): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (global.gc === undefined) throw new Error("run with --expose-gc");
    for (let round = 0; round < rounds; round++) {
      yield* tick;
      global.gc();
    }
  });

const benchmark = {
  collectGarbage,
  decodeJson,
  encodeJson,
  encodePrettyJson,
  nowIso,
};

export default benchmark;

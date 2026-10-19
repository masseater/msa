import { Effect, Schema } from "effect";

import { readTextFile, writeTextFile } from "./files.ts";

const jsonText = Schema.fromJsonString(Schema.Unknown);
const encodeJsonText = Schema.encodeUnknownEffect(jsonText);
const decodeJsonText = Schema.decodeUnknownEffect(jsonText);

export const toJsonText = (value: unknown): Effect.Effect<string> =>
  Effect.orDie(encodeJsonText(value));

export const fromJsonText = (text: string): Effect.Effect<unknown> =>
  Effect.orDie(decodeJsonText(text));

export const readJsonFile = (file: string): Effect.Effect<unknown> =>
  Effect.flatMap(readTextFile(file), fromJsonText);

export const writeJsonFile = Effect.fn("writeJsonFile")(function* (file: string, value: unknown) {
  const text = yield* toJsonText(value);
  yield* writeTextFile(file, `${text}\n`);
});

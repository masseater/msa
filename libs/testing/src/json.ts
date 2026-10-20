import { Effect, Schema } from "effect";

import files from "./files.ts";

const { readTextFile, writeTextFile } = files;

const jsonText = Schema.fromJsonString(Schema.Unknown);
const encodeJsonText = Schema.encodeUnknownEffect(jsonText);
const decodeJsonText = Schema.decodeUnknownEffect(jsonText);

const toJsonText = (value: unknown): Effect.Effect<string> => Effect.orDie(encodeJsonText(value));

const fromJsonText = (text: string): Effect.Effect<unknown> => Effect.orDie(decodeJsonText(text));

const readJsonFile = (file: string): Effect.Effect<unknown> =>
  Effect.flatMap(readTextFile(file), fromJsonText);

const writeJsonFile = Effect.fn("writeJsonFile")(function* (file: string, value: unknown) {
  const text = yield* toJsonText(value);
  yield* writeTextFile(file, `${text}\n`);
});

const json = {
  fromJsonText,
  readJsonFile,
  toJsonText,
  writeJsonFile,
};

export default json;

import { Data, Effect, Schema } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  appendTextFile,
  changeMode,
  copyFile,
  currentTimeMillis,
  failure,
  fileSize,
  fromJsonText,
  joinPath,
  makeDirectory,
  makeTempDir,
  pathExists,
  pollUntil,
  randomSuffix,
  readDirectory,
  readJsonFile,
  readTextFile,
  removeDir,
  runTest,
  toJsonText,
  writeJsonFile,
  writeTextFile,
} from "../src/index.ts";

class TestFailure extends Data.TaggedError("TestFailure")<{ readonly message: string }> {}

const created: string[] = [];

const newDir = Effect.gen(function* () {
  const directory = yield* makeTempDir("msa-testing-");
  created.push(directory);
  return directory;
});

afterEach(() => runTest(Effect.forEach(created.splice(0), removeDir, { discard: true })));

describe("files", () => {
  it("writes, appends and reads text", () =>
    runTest(
      Effect.gen(function* () {
        const directory = yield* newDir;
        const file = joinPath(directory, "notes.txt");
        yield* writeTextFile(file, "one\n");
        yield* appendTextFile(file, "two\n");
        expect(yield* readTextFile(file)).toBe("one\ntwo\n");
        expect(yield* pathExists(file)).toBe(true);
        expect(yield* readDirectory(directory)).toEqual(["notes.txt"]);
        expect(yield* fileSize(file)).toBe(8n);
      }),
    ));

  it("creates nested directories and copies files", () =>
    runTest(
      Effect.gen(function* () {
        const directory = yield* newDir;
        const nested = joinPath(directory, "a", "b");
        yield* makeDirectory(nested);
        expect(yield* pathExists(nested)).toBe(true);
        const source = joinPath(directory, "source.txt");
        yield* writeTextFile(source, "copy");
        const target = joinPath(nested, "target.txt");
        yield* copyFile(source, target);
        yield* changeMode(target, 0o600);
        expect(yield* readTextFile(target)).toBe("copy");
      }),
    ));
});

describe("json", () => {
  it("round trips values through schema json text", () =>
    runTest(
      Effect.gen(function* () {
        const value = { name: "msa", nested: [1, 2, { ok: true }] };
        const text = yield* toJsonText(value);
        expect(yield* fromJsonText(text)).toEqual(value);
      }),
    ));

  it("writes json files with a trailing newline", () =>
    runTest(
      Effect.gen(function* () {
        const directory = yield* newDir;
        const file = joinPath(directory, "value.json");
        yield* writeJsonFile(file, { enabled: true });
        expect(yield* readTextFile(file)).toBe('{"enabled":true}\n');
        expect(yield* readJsonFile(file)).toEqual({ enabled: true });
      }),
    ));

  it("decodes typed json text", () =>
    runTest(
      Effect.gen(function* () {
        const decode = Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.Struct({ count: Schema.Finite })),
        );
        expect(yield* decode('{"count":3}')).toEqual({ count: 3 });
      }),
    ));
});

describe("effect support", () => {
  it("awaits promised values", () =>
    runTest(
      Effect.gen(function* () {
        const value = yield* Effect.promise(() => Promise.resolve("promised"));
        expect(value).toBe("promised");
      }),
    ));

  it("reports the failure of an effect", () =>
    runTest(
      Effect.gen(function* () {
        const cause = yield* failure(Effect.fail(new TestFailure({ message: "boom" })));
        expect(String(cause)).toContain("boom");
      }),
    ));

  it("polls until a condition holds", () =>
    runTest(
      Effect.gen(function* () {
        let checks = 0;
        yield* pollUntil(
          Effect.sync(() => {
            checks++;
            return checks >= 3;
          }),
          10,
          "1 millis",
        );
        expect(checks).toBe(3);
      }),
    ));

  it("reads the clock and a random suffix", () =>
    runTest(
      Effect.gen(function* () {
        expect(currentTimeMillis()).toBeGreaterThan(0);
        expect(yield* randomSuffix).toHaveLength(12);
        expect(yield* randomSuffix).not.toBe(yield* randomSuffix);
      }),
    ));
});

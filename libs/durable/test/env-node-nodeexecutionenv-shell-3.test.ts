import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import effectSupport from "./effect-support.ts";
import envNodeSupport from "./env-node-support.ts";
import platformSupport from "./platform-support.ts";

const { awaited, toJsonText } = effectSupport;
const { cleanUpEnvTests, createTempDir, tempDirs } = envNodeSupport;
const { joinPath } = platformSupport;

afterEach(() => Effect.runPromise(cleanUpEnvTests), 15_000);

const doesNotCreate = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  const result = getOrThrow(
    yield* awaited(
      env.exec(
        "printf short",
        {
          spill: { afterBytes: 100, afterLines: 10 },
        },
        BACKGROUND_CONTEXT,
      ),
    ),
  );
  expect(result.spillPath).toBeUndefined();
});

const preservesExactRaw = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  const expected = [0x66, 0x80, 0x00, 0x6f];
  const result = getOrThrow(
    yield* awaited(
      env.exec(
        `${yield* toJsonText(process.execPath)} -e "process.stdout.write(Buffer.from([${expected.join(",")}]))"`,
        {
          spill: { afterBytes: 1, afterLines: 10 },
        },
        BACKGROUND_CONTEXT,
      ),
    ),
  );
  expect(result.spillPath).toBeDefined();
  tempDirs.push(joinPath(result.spillPath!, ".."));
  expect([
    ...getOrThrow(yield* awaited(env.readBinaryFile(result.spillPath!, BACKGROUND_CONTEXT))),
  ]).toEqual(expected);
});

describe("NodeExecutionEnv shell", () => {
  it("does not create a spill before output crosses its thresholds", () =>
    Effect.runPromise(doesNotCreate));

  it(
    "preserves exact raw bytes in the spill while streaming decoded text",
    () => Effect.runPromise(preservesExactRaw),
    20_000,
  );
});

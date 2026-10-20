import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import envModule from "../src/env/index.ts";
import toolsModule from "../src/tools/index.ts";
import effectSupport from "./effect-support.ts";
import toolsSupport from "./tools-support.ts";

const { createBashTool } = toolsModule;
const { getOrThrow } = envModule;

const { awaited } = effectSupport;
const { createEnv, removeTempDirs, run } = toolsSupport;

afterAll(() => Effect.runPromise(removeTempDirs));

const supportsCommandPrefixes = Effect.gen(function* () {
  const result = yield* awaited(
    run(
      createBashTool({ commandPrefix: "value=hello" }),
      { command: "printf $value" },
      yield* createEnv,
    ),
  );
  expect(result.streamed.join("")).toBe("hello");
});

const streamsEveryByte = Effect.gen(function* () {
  const env = yield* createEnv;
  const result = yield* awaited(
    run(
      createBashTool(),
      { command: "i=1; while [ $i -le 3000 ]; do echo line-$i; i=$((i + 1)); done" },
      env,
    ),
  );
  const expected = Array.from({ length: 3000 }, (_, index) => `line-${index + 1}\n`).join("");
  expect(result.streamed.join("")).toBe(expected);
  const fullOutputPath = result.reported[0]?.message.match(/^Full output: (.+)$/u)?.[1];
  expect(fullOutputPath).toBeDefined();
  expect(getOrThrow(yield* awaited(env.readTextFile(fullOutputPath!, BACKGROUND_CONTEXT)))).toBe(
    expected,
  );
});

const doesNotSpill = Effect.gen(function* () {
  const result = yield* awaited(
    run(createBashTool(), { command: "printf small" }, yield* createEnv),
  );
  expect(result.reported).toEqual([]);
});

describe("durable tools", () => {
  describe("bash", () => {
    it("supports command prefixes", () => Effect.runPromise(supportsCommandPrefixes));

    it("streams every byte and spills complete output beyond the default limits", () =>
      Effect.runPromise(streamsEveryByte));

    it("does not spill output within the limits", () => Effect.runPromise(doesNotSpill));
  });
});

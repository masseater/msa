import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { createBashTool } from "../src/tools/index.ts";
import { awaited } from "./effect-support.ts";
import { createEnv, run, removeTempDirs } from "./tools-support.ts";

afterAll(() => Effect.runPromise(removeTempDirs));

describe("durable tools", () => {
  describe("bash", () => {
    it("supports command prefixes", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const result = yield* awaited(
            run(
              createBashTool({ commandPrefix: "value=hello" }),
              { command: "printf $value" },
              yield* createEnv,
            ),
          );
          expect(result.streamed.join("")).toBe("hello");
        }),
      ));

    it("streams every byte and spills complete output beyond the default limits", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const env = yield* createEnv;
          const result = yield* awaited(
            run(
              createBashTool(),
              { command: "i=1; while [ $i -le 3000 ]; do echo line-$i; i=$((i + 1)); done" },
              env,
            ),
          );
          const expected = Array.from({ length: 3000 }, (_, index) => `line-${index + 1}\n`).join(
            "",
          );
          expect(result.streamed.join("")).toBe(expected);
          const fullOutputPath = result.reported[0]?.message.match(/^Full output: (.+)$/u)?.[1];
          expect(fullOutputPath).toBeDefined();
          expect(
            getOrThrow(yield* awaited(env.readTextFile(fullOutputPath!, BACKGROUND_CONTEXT))),
          ).toBe(expected);
        }),
      ));

    it("does not spill output within the limits", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const result = yield* awaited(
            run(createBashTool(), { command: "printf small" }, yield* createEnv),
          );
          expect(result.reported).toEqual([]);
        }),
      ));
  });
});

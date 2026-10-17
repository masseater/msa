import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { createBashTool } from "../src/tools/index.ts";
import { createEnv, run, removeTempDirs } from "./tools-support.ts";

afterAll(removeTempDirs);

describe("durable tools", () => {
  describe("bash", () => {
    it("supports command prefixes", async () => {
      const result = await run(
        createBashTool({ commandPrefix: "value=hello" }),
        { command: "printf $value" },
        createEnv(),
      );
      expect(result.streamed.join("")).toBe("hello");
    });

    it("streams every byte and spills complete output beyond the default limits", async () => {
      const env = createEnv();
      const result = await run(
        createBashTool(),
        { command: "i=1; while [ $i -le 3000 ]; do echo line-$i; i=$((i + 1)); done" },
        env,
      );
      const expected = Array.from({ length: 3000 }, (_, index) => `line-${index + 1}\n`).join("");
      expect(result.streamed.join("")).toBe(expected);
      const fullOutputPath = result.reported[0]?.message.match(/^Full output: (.+)$/u)?.[1];
      expect(fullOutputPath).toBeDefined();
      expect(getOrThrow(await env.readTextFile(fullOutputPath!, BACKGROUND_CONTEXT))).toBe(
        expected,
      );
    });

    it("does not spill output within the limits", async () => {
      const result = await run(createBashTool(), { command: "printf small" }, createEnv());
      expect(result.reported).toEqual([]);
    });
  });
});

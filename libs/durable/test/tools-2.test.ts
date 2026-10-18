import { applyPatch } from "diff";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { createEditTool } from "../src/tools/index.ts";
import { awaited, BACKGROUND_CONTEXT } from "./support.ts";
import { textOutput, createEnv, run, removeTempDirs } from "./tools-support.ts";

afterAll(() => Effect.runPromise(removeTempDirs));

describe("durable tools", () => {
  describe("edit", () => {
    it("applies disjoint edits and returns both diff formats", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const env = yield* createEnv;
          const original = "alpha\nbeta\ngamma\ndelta\n";
          getOrThrow(yield* awaited(env.writeFile("edit.txt", original, BACKGROUND_CONTEXT)));
          const result = yield* awaited(
            run(
              createEditTool(),
              {
                path: "edit.txt",
                edits: [
                  { oldText: "alpha\n", newText: "ALPHA\n" },
                  { oldText: "gamma\n", newText: "GAMMA\n" },
                ],
              },
              env,
            ),
          );
          const details = result.details as { diff: string; patch: string };
          expect(textOutput(result)).toBe("Successfully replaced 2 block(s) in edit.txt.");
          expect(details.diff).toContain("ALPHA");
          expect(details.diff).toContain("GAMMA");
          expect(applyPatch(original, details.patch)).toBe("ALPHA\nbeta\nGAMMA\ndelta\n");
          expect(getOrThrow(yield* awaited(env.readTextFile("edit.txt", BACKGROUND_CONTEXT)))).toBe(
            "ALPHA\nbeta\nGAMMA\ndelta\n",
          );
        }),
      ));

    it("repairs edits sent as a JSON string, a single object, or top-level oldText/newText without mutating them", () => {
      const prepare = createEditTool().prepareArguments!;
      const edit = { oldText: "a", newText: "b" };
      const asString = { path: "f", edits: JSON.stringify([edit]) };
      expect(prepare(asString)).toEqual({ path: "f", edits: [edit] });
      expect(asString.edits).toBe(JSON.stringify([edit]));
      expect(prepare({ path: "f", edits: JSON.stringify(edit) })).toEqual({
        path: "f",
        edits: [edit],
      });
      expect(prepare({ path: "f", edits: edit })).toEqual({ path: "f", edits: [edit] });
      expect(prepare({ path: "f", edits: [edit], oldText: "c", newText: "d" })).toEqual({
        path: "f",
        edits: [edit, { oldText: "c", newText: "d" }],
      });
      expect(prepare({ path: "f", edits: "not json" })).toEqual({ path: "f", edits: "not json" });
    });
  });
});

import { applyPatch } from "diff";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import envModule from "../src/env/index.ts";
import toolsModule from "../src/tools/index.ts";
import support from "./support.ts";
import toolsSupport from "./tools-support.ts";

const { getOrThrow } = envModule;
const { createEditTool } = toolsModule;

const { BACKGROUND_CONTEXT, awaited } = support;
const { createEnv, removeTempDirs, run, textOutput } = toolsSupport;

afterAll(() => Effect.runPromise(removeTempDirs));

const appliesDisjointEdits = Effect.gen(function* () {
  const env = yield* createEnv;
  const original = "alpha\nbeta\ngamma\ndelta\n";
  getOrThrow(yield* awaited(env.writeFile("edit.txt", original, BACKGROUND_CONTEXT)));
  const result = yield* awaited(
    run(
      createEditTool(),
      {
        edits: [
          { newText: "ALPHA\n", oldText: "alpha\n" },
          { newText: "GAMMA\n", oldText: "gamma\n" },
        ],
        path: "edit.txt",
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
});

describe("durable tools", () => {
  describe("edit", () => {
    it("applies disjoint edits and returns both diff formats", () =>
      Effect.runPromise(appliesDisjointEdits));

    it("repairs edits sent as a JSON string, a single object, or top-level oldText/newText without mutating them", () => {
      const prepare = createEditTool().prepareArguments!;
      const edit = { newText: "b", oldText: "a" };
      const asString = { edits: JSON.stringify([edit]), path: "f" };
      expect(prepare(asString)).toEqual({ edits: [edit], path: "f" });
      expect(asString.edits).toBe(JSON.stringify([edit]));
      expect(prepare({ edits: JSON.stringify(edit), path: "f" })).toEqual({
        edits: [edit],
        path: "f",
      });
      expect(prepare({ edits: edit, path: "f" })).toEqual({ edits: [edit], path: "f" });
      expect(prepare({ edits: [edit], newText: "d", oldText: "c", path: "f" })).toEqual({
        edits: [edit, { newText: "d", oldText: "c" }],
        path: "f",
      });
      expect(prepare({ edits: "not json", path: "f" })).toEqual({ edits: "not json", path: "f" });
    });
  });
});

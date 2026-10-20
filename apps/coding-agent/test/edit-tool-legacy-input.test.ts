import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { ExtensionToolContext } from "../src/core/extensions/types.ts";
import { createEditToolDefinition } from "../src/core/tools/edit.ts";

const { awaited, joinPath, makeTempDir, readTextFile, removeDirs, runTest, writeTextFile } =
  testing;

const tempDirs: string[] = [];

const createTempDir: Effect.Effect<string> = Effect.gen(function* () {
  const dir = yield* makeTempDir("msa-edit-legacy-input-");
  tempDirs.push(dir);
  return dir;
});

afterEach(() => runTest(removeDirs(tempDirs.splice(0))));

const keepsLegacyFieldsOutOfThePublic = () => {
  const definition = createEditToolDefinition(process.cwd());
  expect(definition.parameters.properties).not.toHaveProperty("oldText");
  expect(definition.parameters.properties).not.toHaveProperty("newText");
};

const foldsTopLevelOldtextNewtextIntoEdits = () => {
  const definition = createEditToolDefinition(process.cwd());
  const prepared = definition.prepareArguments!({
    newText: "after",
    oldText: "before",
    path: "file.txt",
  });
  expect(prepared).toEqual({
    edits: [{ newText: "after", oldText: "before" }],
    path: "file.txt",
  });
};

const appendsLegacyReplacementToExistingEdits = () => {
  const definition = createEditToolDefinition(process.cwd());
  const prepared = definition.prepareArguments!({
    edits: [{ newText: "b", oldText: "a" }],
    newText: "d",
    oldText: "c",
    path: "file.txt",
  });
  expect(prepared).toEqual({
    edits: [
      { newText: "b", oldText: "a" },
      { newText: "d", oldText: "c" },
    ],
    path: "file.txt",
  });
};

const passesThroughValidInputUnchanged = () => {
  const definition = createEditToolDefinition(process.cwd());
  const input = {
    edits: [{ newText: "b", oldText: "a" }],
    path: "file.txt",
  };
  const prepared = definition.prepareArguments!(input);
  expect(prepared).toBe(input);
};

const passesThroughNonObjectInputUnchanged = () => {
  const definition = createEditToolDefinition(process.cwd());
  expect(definition.prepareArguments!(null)).toBe(null);
  expect(definition.prepareArguments!(undefined)).toBe(undefined);
  expect(definition.prepareArguments!("garbage")).toBe("garbage");
};

const preparedArgsExecuteCorrectly = () =>
  runTest(
    Effect.gen(function* () {
      const dir = yield* createTempDir;
      const filePath = joinPath(dir, "legacy.txt");
      yield* writeTextFile(filePath, "before\n");

      const definition = createEditToolDefinition(dir);
      const prepared = definition.prepareArguments!({
        newText: "after",
        oldText: "before",
        path: "legacy.txt",
      });

      const result = yield* awaited(
        definition.execute("tool-1", prepared, undefined, undefined, {} as ExtensionToolContext),
      );
      expect(result.content).toEqual([
        { text: "Successfully replaced 1 block(s) in legacy.txt.", type: "text" as const },
      ]);
      expect(yield* readTextFile(filePath)).toBe("after\n");
    }),
  );

describe("edit tool prepareArguments", () => {
  it("keeps legacy fields out of the public schema", keepsLegacyFieldsOutOfThePublic);

  it("folds top-level oldText/newText into edits", foldsTopLevelOldtextNewtextIntoEdits);

  it("appends legacy replacement to existing edits", appendsLegacyReplacementToExistingEdits);

  it("passes through valid input unchanged", passesThroughValidInputUnchanged);

  it("passes through non-object input unchanged", passesThroughNonObjectInputUnchanged);

  it("prepared args execute correctly", preparedArgsExecuteCorrectly);
});

const parsesEditsFromAJsonString = () => {
  const definition = createEditToolDefinition(process.cwd());
  const prepared = definition.prepareArguments!({
    edits: JSON.stringify([{ newText: "b", oldText: "a" }]),
    path: "file.txt",
  });
  expect(prepared).toEqual({
    edits: [{ newText: "b", oldText: "a" }],
    path: "file.txt",
  });
};

const leavesEditsAloneWhenTheStringIs = () => {
  const definition = createEditToolDefinition(process.cwd());
  const prepared = definition.prepareArguments!({
    edits: "not json",
    path: "file.txt",
  });
  expect(prepared).toEqual({
    edits: "not json",
    path: "file.txt",
  });
};

describe("edit tool stringified edits", () => {
  it("parses edits from a JSON string", parsesEditsFromAJsonString);

  it("leaves edits alone when the string is not valid JSON", leavesEditsAloneWhenTheStringIs);
});

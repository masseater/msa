import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";
import edit from "../src/core/tools/edit.ts";

const { createEditToolDefinition } = edit;

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
        definition.execute(
          "tool-1",
          prepared,
          undefined,
          undefined,
          {} as extensionsTypesTypes.ExtensionToolContext,
        ),
      );
      expect(result.content).toEqual([
        { text: "Successfully replaced 1 block(s) in legacy.txt.", type: "text" as const },
      ]);
      expect(yield* readTextFile(filePath)).toBe("after\n");
    }),
  );

const validInput = {
  edits: [{ newText: "b", oldText: "a" }],
  path: "file.txt",
};

const rewrittenCases = [
  {
    expected: { edits: [{ newText: "after", oldText: "before" }], path: "file.txt" },
    input: { newText: "after", oldText: "before", path: "file.txt" },
    name: "folds top-level oldText/newText into edits",
  },
  {
    expected: {
      edits: [
        { newText: "b", oldText: "a" },
        { newText: "d", oldText: "c" },
      ],
      path: "file.txt",
    },
    input: {
      edits: [{ newText: "b", oldText: "a" }],
      newText: "d",
      oldText: "c",
      path: "file.txt",
    },
    name: "appends legacy replacement to existing edits",
  },
  {
    expected: { edits: [{ newText: "b", oldText: "a" }], path: "file.txt" },
    input: { edits: JSON.stringify([{ newText: "b", oldText: "a" }]), path: "file.txt" },
    name: "parses edits from a JSON string",
  },
  {
    expected: { edits: "not json", path: "file.txt" },
    input: { edits: "not json", path: "file.txt" },
    name: "leaves edits alone when the string is not valid JSON",
  },
];

const passedThroughCases = [
  { input: validInput, name: "passes through valid input unchanged" },
  { input: null, name: "passes through null unchanged" },
  { input: undefined, name: "passes through undefined unchanged" },
  { input: "garbage", name: "passes through a string unchanged" },
];

describe("edit tool prepareArguments", () => {
  it("keeps legacy fields out of the public schema", keepsLegacyFieldsOutOfThePublic);

  it.each(rewrittenCases)("$name", ({ expected, input }) => {
    const definition = createEditToolDefinition(process.cwd());
    expect(definition.prepareArguments!(input)).toEqual(expected);
  });

  it.each(passedThroughCases)("$name", ({ input }) => {
    const definition = createEditToolDefinition(process.cwd());
    expect(definition.prepareArguments!(input)).toBe(input);
  });

  it("prepared args execute correctly", preparedArgsExecuteCorrectly);
});

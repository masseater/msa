import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import externalEditor from "../src/modes/interactive/external-editor.ts";
import type externalEditorTypes from "../src/modes/interactive/external-editor.types.ts";

const { editInExternalEditor } = externalEditor;

const {
  awaited,
  basenameOf,
  dirnameOf,
  fromJsonText,
  joinPath,
  makeTempDir,
  pathExists,
  readTextFile,
  removePath,
  runTest,
} = testing;

const editorFixturePath = fileURLToPath(
  new URL("./fixtures/fake-external-editor.ts", import.meta.url),
);

interface EditorCapture {
  filePath: string;
  content: string;
  entries: string[];
  directoryMode: number;
}

function runExternalEditor(fixtureFlag?: "--fail" | "--empty"): Promise<{
  result: externalEditorTypes.ExternalEditorResult;
  capture: EditorCapture;
}> {
  return runTest(
    Effect.gen(function* () {
      const testDirectory = yield* makeTempDir("msa-external-editor-test-");
      const capturePath = joinPath(testDirectory, "capture.json");
      try {
        const result = yield* awaited(
          editInExternalEditor({
            command: `${process.execPath} ${editorFixturePath} ${capturePath}${fixtureFlag !== undefined && fixtureFlag.length > 0 ? ` ${fixtureFlag}` : ""}`,
            content: "original",
          }),
        );
        const capture = (yield* fromJsonText(yield* readTextFile(capturePath))) as EditorCapture;
        return yield* awaited({ capture, result });
      } finally {
        yield* removePath(testDirectory);
      }
    }),
  );
}

const editsAPromptInsideAPrivateTemporary = () =>
  runTest(
    Effect.gen(function* () {
      const { result, capture } = yield* awaited(runExternalEditor());
      const directory = dirnameOf(capture.filePath);

      expect(result).toEqual({ content: "edited", status: "complete" });
      expect(dirnameOf(directory)).toBe(tmpdir());
      expect(basenameOf(directory)).toMatch(/^msa-editor-.+$/u);
      expect(basenameOf(capture.filePath)).toBe("prompt.md");
      expect(capture.entries).toEqual(["prompt.md"]);
      expect(capture.content).toBe("original");
      if (process.platform !== "win32") {
        expect(capture.directoryMode & 0o077).toBe(0);
      }
      expect(yield* pathExists(directory)).toBe(false);
    }),
  );

const keepsTheOriginalContentWhenTheEditor = () =>
  runTest(
    Effect.gen(function* () {
      const { result, capture } = yield* awaited(runExternalEditor("--fail"));

      expect(result).toEqual({ status: "failed" });
      expect(yield* pathExists(dirnameOf(capture.filePath))).toBe(false);
    }),
  );

const returnsEmptyContentWhenTheEditorClears = () =>
  runTest(
    Effect.gen(function* () {
      const { result } = yield* awaited(runExternalEditor("--empty"));

      expect(result).toEqual({ content: "", status: "complete" });
    }),
  );

describe("editInExternalEditor", () => {
  it("edits a prompt inside a private temporary directory", editsAPromptInsideAPrivateTemporary);

  it(
    "keeps the original content when the editor exits unsuccessfully",
    keepsTheOriginalContentWhenTheEditor,
  );
  it(
    "returns empty content when the editor clears the prompt",
    returnsEmptyContentWhenTheEditorClears,
  );
});

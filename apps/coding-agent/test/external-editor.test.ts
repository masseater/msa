import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  awaited,
  runTest,
  fromJsonText,
  readTextFile,
  pathExists,
  removePath,
  makeTempDir,
  joinPath,
  dirnameOf,
  basenameOf,
} from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  type ExternalEditorResult,
  editInExternalEditor,
} from "../src/modes/interactive/external-editor.ts";

const editorFixturePath = fileURLToPath(
  new URL("./fixtures/fake-external-editor.mjs", import.meta.url),
);

interface EditorCapture {
  filePath: string;
  content: string;
  entries: string[];
  directoryMode: number;
}

function runExternalEditor(fixtureFlag?: "--fail" | "--empty"): Promise<{
  result: ExternalEditorResult;
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
        return yield* awaited({ result, capture });
      } finally {
        yield* removePath(testDirectory);
      }
    }),
  );
}

describe("editInExternalEditor", () => {
  it("edits a prompt inside a private temporary directory", () =>
    runTest(
      Effect.gen(function* () {
        const { result, capture } = yield* awaited(runExternalEditor());
        const directory = dirnameOf(capture.filePath);

        expect(result).toEqual({ status: "complete", content: "edited" });
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
    ));

  it("keeps the original content when the editor exits unsuccessfully", () =>
    runTest(
      Effect.gen(function* () {
        const { result, capture } = yield* awaited(runExternalEditor("--fail"));

        expect(result).toEqual({ status: "failed" });
        expect(yield* pathExists(dirnameOf(capture.filePath))).toBe(false);
      }),
    ));
  it("returns empty content when the editor clears the prompt", () =>
    runTest(
      Effect.gen(function* () {
        const { result } = yield* awaited(runExternalEditor("--empty"));

        expect(result).toEqual({ status: "complete", content: "" });
      }),
    ));
});

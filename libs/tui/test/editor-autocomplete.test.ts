import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { CombinedAutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { applyCompletion, createTestTUI, flushAutocomplete } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Autocomplete", () => {
    autocompleteCases6();
  });
});

function autocompleteCases6(): void {
  it("triggers and debounces symbol completion after CJK punctuation", (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        for (const before of [
          "查看，",
          "\u3000",
          ..."，．：；！？（）［］｛｝“”‘’…—。、「」『』《》【】",
          "(",
          "see (",
          "`",
          "[",
        ]) {
          for (const trigger of ["@", "#", "$", "-"]) {
            const editor = new Editor(createTestTUI(), defaultEditorTheme);
            const requests: string[] = [];
            editor.setAutocompleteProvider({
              triggerCharacters: ["$", "-"],
              getSuggestions: (lines, cursorLine, cursorCol) => {
                requests.push(lines[cursorLine]!.slice(0, cursorCol));
                return Promise.resolve(null);
              },
              applyCompletion,
            });
            editor.setText(before);
            editor.handleInput(trigger);
            t.mock.timers.tick(19);
            yield* flushAutocomplete;
            assert.deepStrictEqual(requests, []);
            t.mock.timers.tick(1);
            yield* flushAutocomplete;
            assert.deepStrictEqual(requests, [before + trigger]);

            editor.handleInput("r");
            editor.handleInput("e");
            t.mock.timers.tick(19);
            yield* flushAutocomplete;
            assert.strictEqual(requests.length, 1);
            t.mock.timers.tick(1);
            yield* flushAutocomplete;
            assert.deepStrictEqual(requests, [before + trigger, `${before}${trigger}re`]);
          }
        }
      }),
    ));
}

describe("Editor component", () => {
  describe("Autocomplete", () => {
    autocompleteCases7();
  });
});

function autocompleteCases7(): void {
  it("does not auto-trigger after CJK letters or for unprefixed paths", (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const editor = new Editor(createTestTUI(), defaultEditorTheme);
        let requests = 0;
        editor.setAutocompleteProvider({
          getSuggestions: () => {
            requests++;
            return Promise.resolve(null);
          },
          applyCompletion,
        });
        for (const text of [
          "user@example.com",
          "张三@example.com",
          "查看@src",
          "あ@src",
          "カ@src",
          "한@src",
          "ㄅ@src",
          "𠮷@src",
          "か\u3099@src",
          "禰\u{e0100}@src",
          "々@src",
          "Ａ@src",
          "文档@备份",
          "prefix#123",
          "foo(@src",
          "问题#123",
          "查看，/path/",
          "查看，./文档/",
          "src/index.ts",
          "./文档/说明.md",
          "文档/说明.md",
          "查看src/index.ts",
        ]) {
          editor.setText("");
          for (const char of text) editor.handleInput(char);
          t.mock.timers.tick(20);
          yield* flushAutocomplete;
          assert.strictEqual(requests, 0, text);
        }
      }),
    ));
}

describe("Editor component", () => {
  describe("Autocomplete", () => {
    it("requests path completion after CJK punctuation only on Tab", (t) =>
      Effect.runPromise(
        Effect.gen(function* () {
          t.mock.timers.enable({ apis: ["setTimeout"] });
          const editor = new Editor(createTestTUI(), defaultEditorTheme);
          const requests: Array<{ text: string; force: boolean | undefined }> = [];
          editor.setAutocompleteProvider({
            getSuggestions: (lines, cursorLine, cursorCol, options) => {
              requests.push({ text: lines[cursorLine]!.slice(0, cursorCol), force: options.force });
              return Promise.resolve(null);
            },
            applyCompletion,
          });
          const text = "查看，/path/";
          for (const char of text) editor.handleInput(char);
          t.mock.timers.tick(20);
          yield* flushAutocomplete;
          assert.deepStrictEqual(requests, []);
          editor.handleInput("\t");
          yield* flushAutocomplete;
          assert.deepStrictEqual(requests, [{ text, force: true }]);
        }),
      ));
  });
});

describe("Editor component", () => {
  describe("Autocomplete", () => {
    it("completes Chinese path prefixes after whitespace or CJK punctuation with Tab", (t) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const baseDir = mkdtempSync(join(tmpdir(), "msa-editor-autocomplete-"));
          t.after(() => rmSync(baseDir, { recursive: true, force: true }));
          mkdirSync(join(baseDir, "文档"));
          writeFileSync(join(baseDir, "文档", "说明.md"), "text");
          const editor = new Editor(createTestTUI(), defaultEditorTheme);
          editor.setAutocompleteProvider(new CombinedAutocompleteProvider([], baseDir));
          for (const separator of [" ", "\t", "\u3000", "\u00a0", "，", "。"]) {
            editor.setText(`查看${separator}`);
            const before = editor.getText();
            editor.handleInput("文");
            editor.handleInput("\t");
            yield* flushAutocomplete;
            assert.strictEqual(editor.getText(), `${before}文档/`);
            editor.handleInput("说");
            editor.handleInput("\t");
            yield* flushAutocomplete;
            assert.strictEqual(editor.getText(), `${before}文档/说明.md`);
            assert.deepStrictEqual(editor.getCursor(), { line: 0, col: editor.getText().length });
          }
        }),
      ));
  });
});

describe("Editor component", () => {
  describe("Autocomplete", () => {
    it("ends unquoted trigger and debounce contexts at whitespace or CJK punctuation", (t) =>
      Effect.runPromise(
        Effect.gen(function* () {
          t.mock.timers.enable({ apis: ["setTimeout"] });
          for (const separator of [" ", "\u3000", "，", "。"]) {
            for (const trigger of ["@", "#", "$"]) {
              const editor = new Editor(createTestTUI(), defaultEditorTheme);
              const requests: string[] = [];
              const prefix = `${trigger}src`;
              editor.setAutocompleteProvider({
                triggerCharacters: ["$"],
                getSuggestions: (lines, cursorLine, cursorCol) => {
                  const text = lines[cursorLine]!.slice(0, cursorCol);
                  requests.push(text);
                  return Promise.resolve(
                    text === prefix
                      ? { prefix, items: [{ value: `${prefix}/`, label: "src/" }] }
                      : null,
                  );
                },
                applyCompletion,
              });
              editor.setText(`${trigger}sr`);
              editor.handleInput("c");
              t.mock.timers.tick(20);
              yield* flushAutocomplete;
              assert.strictEqual(editor.isShowingAutocomplete(), true);
              editor.handleInput(separator);
              yield* flushAutocomplete;
              assert.deepStrictEqual(requests, [prefix, prefix + separator]);
              assert.strictEqual(editor.isShowingAutocomplete(), false);
              editor.handleInput("文");
              t.mock.timers.tick(20);
              yield* flushAutocomplete;
              assert.deepStrictEqual(requests, [prefix, prefix + separator]);
            }
          }
        }),
      ));
  });
});

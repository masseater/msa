import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import CombinedAutocompleteProvider from "../src/autocomplete.ts";
import type autocompleteTypes from "../src/autocomplete.types.ts";
import Editor from "../src/components/editor.ts";
import platform from "../src/platform.ts";
import editorHelpers from "./editor-helpers.ts";
import testPlatform from "./test-platform.ts";
import testThemes from "./test-themes.ts";

const { defaultEditorTheme } = testThemes;
const { applyCompletion, createTestTUI, flushAutocomplete, settlingProvider } = editorHelpers;
const { makeTempDirectory, removeRecursive, writeFileString } = testPlatform;
const { join } = platform.pathOperations;

describe("Editor component", () => {
  describe("Autocomplete", () => {
    triggersDebouncesSymbolCompletionAfter();
    doesNotAutoTriggerAfter();
    requestsPathCompletionAfterCJK();
    completesChinesePathPrefixesAfter();
    endsUnquotedTriggerDebounceContexts();
    reTriggersCJKPathCompletion();
  });
});

function triggersDebouncesSymbolCompletionAfter(): void {
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
              applyCompletion,
              getSuggestions: (lines, cursorLine, cursorCol) => {
                requests.push(lines[cursorLine]!.slice(0, cursorCol));
                return Promise.resolve(null);
              },
              triggerCharacters: ["$", "-"],
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

function doesNotAutoTriggerAfter(): void {
  it("does not auto-trigger after CJK letters or for unprefixed paths", (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const editor = new Editor(createTestTUI(), defaultEditorTheme);
        let requests = 0;
        editor.setAutocompleteProvider({
          applyCompletion,
          getSuggestions: () => {
            requests++;
            return Promise.resolve(null);
          },
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

function requestsPathCompletionAfterCJK(): void {
  it("requests path completion after CJK punctuation only on Tab", (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const editor = new Editor(createTestTUI(), defaultEditorTheme);
        const requests: Array<{ text: string; force: boolean | undefined }> = [];
        editor.setAutocompleteProvider({
          applyCompletion,
          getSuggestions: (lines, cursorLine, cursorCol, options) => {
            requests.push({ force: options.force, text: lines[cursorLine]!.slice(0, cursorCol) });
            return Promise.resolve(null);
          },
        });
        const text = "查看，/path/";
        for (const char of text) editor.handleInput(char);
        t.mock.timers.tick(20);
        yield* flushAutocomplete;
        assert.deepStrictEqual(requests, []);
        editor.handleInput("\t");
        yield* flushAutocomplete;
        assert.deepStrictEqual(requests, [{ force: true, text }]);
      }),
    ));
}

function completesChinesePathPrefixesAfter(): void {
  it("completes Chinese path prefixes after whitespace or CJK punctuation with Tab", (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const baseDir = yield* makeTempDirectory("msa-editor-autocomplete-");
        const runPromise = Effect.runPromiseWith(yield* Effect.context());
        t.after(() => runPromise(removeRecursive(baseDir)));
        yield* writeFileString(join(baseDir, "文档", "说明.md"), "text");
        const editor = new Editor(createTestTUI(), defaultEditorTheme);
        const { provider, settled } = settlingProvider(
          new CombinedAutocompleteProvider([], baseDir),
        );
        editor.setAutocompleteProvider(provider);
        for (const separator of [" ", "\t", "\u3000", "\u00a0", "，", "。"]) {
          editor.setText(`查看${separator}`);
          const before = editor.getText();
          editor.handleInput("文");
          editor.handleInput("\t");
          yield* settled;
          assert.strictEqual(editor.getText(), `${before}文档/`);
          editor.handleInput("说");
          editor.handleInput("\t");
          yield* settled;
          assert.strictEqual(editor.getText(), `${before}文档/说明.md`);
          assert.deepStrictEqual(editor.getCursor(), { col: editor.getText().length, line: 0 });
        }
      }),
    ));
}

function endsUnquotedTriggerDebounceContexts(): void {
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
              applyCompletion,
              getSuggestions: (lines, cursorLine, cursorCol) => {
                const text = lines[cursorLine]!.slice(0, cursorCol);
                requests.push(text);
                return Promise.resolve(
                  text === prefix
                    ? { items: [{ label: "src/", value: `${prefix}/` }], prefix }
                    : null,
                );
              },
              triggerCharacters: ["$"],
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
}

function reTriggersCJKPathCompletion(): void {
  it("re-triggers CJK path completion after accepting directories and deleting", (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const provider = new CombinedAutocompleteProvider([], process.cwd());
        for (const directory of ["文档", "我的 文档", "资料，归档"]) {
          const { initial, directoryValue, fileValue, autocomplete } = cjkPathCompletion(
            directory,
            provider,
          );
          const editor = new Editor(createTestTUI(), defaultEditorTheme);
          editor.setAutocompleteProvider(autocomplete);
          editor.setText(`查看：${initial}`);
          editor.handleInput("\t");
          yield* flushAutocomplete;
          assert.strictEqual(editor.getText(), `查看：${directoryValue}`);
          assert.strictEqual(editor.isShowingAutocomplete(), false);

          editor.handleInput("说");
          t.mock.timers.tick(20);
          yield* flushAutocomplete;
          assert.strictEqual(editor.isShowingAutocomplete(), true);

          for (const deletion of ["\x7f", "\x1b[3~"]) {
            editor.handleInput("错");
            t.mock.timers.tick(20);
            yield* flushAutocomplete;
            assert.strictEqual(editor.isShowingAutocomplete(), false);
            if (deletion === "\x1b[3~") editor.handleInput("\x1b[D");
            editor.handleInput(deletion);
            t.mock.timers.tick(20);
            yield* flushAutocomplete;
            assert.strictEqual(editor.isShowingAutocomplete(), true);
          }

          editor.handleInput("\t");
          assert.strictEqual(editor.getText(), `查看：${fileValue} `);
          assert.deepStrictEqual(editor.getCursor(), { col: editor.getText().length, line: 0 });
        }
      }),
    ));
}

function cjkPathCompletion(
  directory: string,
  provider: autocompleteTypes.CombinedAutocompleteProvider,
): {
  initial: string;
  directoryValue: string;
  fileValue: string;
  autocomplete: autocompleteTypes.AutocompleteProvider;
} {
  const quoted = directory !== "文档";
  const initial = quoted ? `@"${directory.slice(0, 2)}` : "@文";
  const directoryValue = quoted ? `@"${directory}/"` : `@${directory}/`;
  const fileValue = quoted ? `@"${directory}/说明.md"` : `@${directory}/说明.md`;
  const filePrefix = quoted ? `@"${directory}/说` : `@${directory}/说`;
  const autocomplete: autocompleteTypes.AutocompleteProvider = {
    applyCompletion: (...args) => provider.applyCompletion(...args),
    getSuggestions: (lines, cursorLine, cursorCol) => {
      const before = lines[cursorLine]!.slice(0, cursorCol);
      const prefix = before.slice(before.indexOf("@"));
      if (prefix === initial) {
        return Promise.resolve({
          items: [{ label: `${directory}/`, value: directoryValue }],
          prefix,
        });
      }
      return Promise.resolve(
        prefix === filePrefix ? { items: [{ label: "说明.md", value: fileValue }], prefix } : null,
      );
    },
  };
  return { autocomplete, directoryValue, fileValue, initial };
}

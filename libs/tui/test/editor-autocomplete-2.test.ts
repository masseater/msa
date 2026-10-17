import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { type AutocompleteProvider, CombinedAutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { applyCompletion, createTestTUI, flushAutocomplete, typeText } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Autocomplete", () => {
    autocompleteCases8();
  });
});

function cjkPathCompletion(
  directory: string,
  provider: CombinedAutocompleteProvider,
): {
  initial: string;
  directoryValue: string;
  fileValue: string;
  autocomplete: AutocompleteProvider;
} {
  const quoted = directory !== "文档";
  const initial = quoted ? `@"${directory.slice(0, 2)}` : "@文";
  const directoryValue = quoted ? `@"${directory}/"` : `@${directory}/`;
  const fileValue = quoted ? `@"${directory}/说明.md"` : `@${directory}/说明.md`;
  const filePrefix = quoted ? `@"${directory}/说` : `@${directory}/说`;
  const autocomplete: AutocompleteProvider = {
    getSuggestions: (lines, cursorLine, cursorCol) => {
      const before = lines[cursorLine]!.slice(0, cursorCol);
      const prefix = before.slice(before.indexOf("@"));
      if (prefix === initial) {
        return Promise.resolve({
          prefix,
          items: [{ value: directoryValue, label: `${directory}/` }],
        });
      }
      return Promise.resolve(
        prefix === filePrefix ? { prefix, items: [{ value: fileValue, label: "说明.md" }] } : null,
      );
    },
    applyCompletion: (...args) => provider.applyCompletion(...args),
  };
  return { initial, directoryValue, fileValue, autocomplete };
}

function autocompleteCases8(): void {
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
          assert.deepStrictEqual(editor.getCursor(), { line: 0, col: editor.getText().length });
        }
      }),
    ));
}

describe("Editor component", () => {
  describe("Autocomplete", () => {
    it("auto-applies single force-file suggestion without showing menu", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const editor = new Editor(createTestTUI(), defaultEditorTheme);

          const mockProvider: AutocompleteProvider = {
            getSuggestions: (lines, _cursorLine, cursorCol, options) => {
              if (options.force !== true) {
                return Promise.resolve(null);
              }
              const text = lines[0] || "";
              const prefix = text.slice(0, cursorCol);
              if (prefix === "Work") {
                return Promise.resolve({
                  items: [{ value: "Workspace/", label: "Workspace/" }],
                  prefix: "Work",
                });
              }
              return Promise.resolve(null);
            },
            applyCompletion,
          };

          editor.setAutocompleteProvider(mockProvider);

          typeText(editor, "Work");
          assert.strictEqual(editor.getText(), "Work");

          editor.handleInput("\t");
          yield* flushAutocomplete;
          assert.strictEqual(editor.getText(), "Workspace/");
          assert.strictEqual(editor.isShowingAutocomplete(), false);

          editor.handleInput("\x1b[45;5u");
          assert.strictEqual(editor.getText(), "Work");
        }),
      ));
  });
});

describe("Editor component", () => {
  describe("Autocomplete", () => {
    autocompleteCases9();
  });
});

function autocompleteCases9(): void {
  it("shows menu when force-file has multiple suggestions", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);

        const mockProvider: AutocompleteProvider = {
          getSuggestions: (lines, _cursorLine, cursorCol, options) => {
            if (options.force !== true) {
              return Promise.resolve(null);
            }
            const text = lines[0] || "";
            const prefix = text.slice(0, cursorCol);
            if (prefix === "src") {
              return Promise.resolve({
                items: [
                  { value: "src/", label: "src/" },
                  { value: "src.txt", label: "src.txt" },
                ],
                prefix: "src",
              });
            }
            return Promise.resolve(null);
          },
          applyCompletion,
        };

        editor.setAutocompleteProvider(mockProvider);

        typeText(editor, "src");
        assert.strictEqual(editor.getText(), "src");

        editor.handleInput("\t");
        yield* flushAutocomplete;
        assert.strictEqual(editor.getText(), "src");
        assert.strictEqual(editor.isShowingAutocomplete(), true);

        editor.handleInput("\t");
        assert.strictEqual(editor.getText(), "src/");
        assert.strictEqual(editor.isShowingAutocomplete(), false);
      }),
    ));
}

describe("Editor component", () => {
  describe("Autocomplete", () => {
    autocompleteCases10();
  });
});

function forceModeFileProvider(): AutocompleteProvider {
  const allFiles = [
    { value: "readme.md", label: "readme.md" },
    { value: "package.json", label: "package.json" },
    { value: "src/", label: "src/" },
    { value: "dist/", label: "dist/" },
  ];

  return {
    getSuggestions: (lines, _cursorLine, cursorCol, options) => {
      const text = lines[0] || "";
      const prefix = text.slice(0, cursorCol);
      const shouldMatch = options.force || prefix.includes("/") || prefix.startsWith(".");
      if (!shouldMatch) {
        return Promise.resolve(null);
      }
      const filtered = allFiles.filter((f) =>
        f.value.toLowerCase().startsWith(prefix.toLowerCase()),
      );
      if (filtered.length > 0) {
        return Promise.resolve({ items: filtered, prefix });
      }
      return Promise.resolve(null);
    },
    applyCompletion,
  };
}

function autocompleteCases10(): void {
  it("keeps suggestions open when typing in force mode (Tab-triggered)", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);
        const mockProvider = forceModeFileProvider();

        editor.setAutocompleteProvider(mockProvider);

        editor.handleInput("\t");
        yield* flushAutocomplete;
        assert.strictEqual(editor.isShowingAutocomplete(), true);

        editor.handleInput("r");
        yield* flushAutocomplete;
        assert.strictEqual(editor.getText(), "r");
        assert.strictEqual(editor.isShowingAutocomplete(), true);

        editor.handleInput("e");
        yield* flushAutocomplete;
        assert.strictEqual(editor.getText(), "re");
        assert.strictEqual(editor.isShowingAutocomplete(), true);

        editor.handleInput("\t");
        assert.strictEqual(editor.getText(), "readme.md");
        assert.strictEqual(editor.isShowingAutocomplete(), false);
      }),
    ));
}

import assert from "node:assert";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";

import { type AutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { applyCompletion, createTestTUI, flushAutocomplete, typeText } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Autocomplete", () => {
    it("debounces @ autocomplete while typing", async () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      let suggestionCalls = 0;

      const mockProvider: AutocompleteProvider = {
        getSuggestions: (lines, _cursorLine, cursorCol) => {
          suggestionCalls += 1;
          const text = (lines[0] || "").slice(0, cursorCol);
          return Promise.resolve({
            items: [{ value: "@main.ts", label: "main.ts" }],
            prefix: text,
          });
        },
        applyCompletion,
      };

      editor.setAutocompleteProvider(mockProvider);

      typeText(editor, "@mai");

      assert.strictEqual(suggestionCalls, 0);
      assert.strictEqual(editor.isShowingAutocomplete(), false);

      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      await flushAutocomplete();

      assert.strictEqual(suggestionCalls, 1);
      assert.strictEqual(editor.isShowingAutocomplete(), true);
    });
  });
});

describe("Editor component", () => {
  describe("Autocomplete", () => {
    autocompleteCases11();
  });
});

function commandArgumentProvider(): AutocompleteProvider {
  return {
    getSuggestions: (lines, _cursorLine, cursorCol) => {
      const before = (lines[0] || "").slice(0, cursorCol);
      if (!before.startsWith("/")) return Promise.resolve(null);
      // Past the command name (a space before the cursor): offer arguments.
      if (before.includes(" ")) {
        return Promise.resolve({
          items: [
            { value: "repo", label: "repo" },
            { value: "message", label: "message" },
            { value: "help", label: "help" },
          ],
          prefix: before.slice(before.indexOf(" ") + 1),
        });
      }
      // Inside the command name: offer the command name only.
      return Promise.resolve({ items: [{ value: "cmd", label: "cmd" }], prefix: before });
    },
    applyCompletion,
  };
}

function autocompleteCases11(): void {
  it("re-queries the autocomplete picker when the cursor moves back into the command name", async () => {
    // Regression for earendil-works/pi#5496: arrowing left out of a slash
    // command's argument region must re-query the picker, not leave the
    // stale argument list showing. Before the fix, moveCursor() never
    // called updateAutocomplete(), so `/cmd ` (argument menu) + Left kept
    // displaying the arguments against a `/cmd` prefix — and a Tab there
    // would concatenate the stale suggestion onto the partial command name.
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.setAutocompleteProvider(commandArgumentProvider());

    // Type `/cmd ` so the picker ends up showing the argument list.
    for await (const ch of "/cmd ") {
      editor.handleInput(ch);
      await flushAutocomplete();
    }
    assert.strictEqual(editor.getText(), "/cmd ");
    assert.strictEqual(editor.isShowingAutocomplete(), true);
    const atArg = editor
      .render(80)
      .map((l) => stripVTControlCharacters(l))
      .join("\n");
    assert.ok(atArg.includes("repo"), "argument menu should be visible at `/cmd `");

    // Arrow Left back into the command name (`/cmd`).
    editor.handleInput("\x1b[D");
    await flushAutocomplete();

    // The picker must have re-queried: the stale argument items are gone
    // (replaced by the command-name suggestion, or the picker closed).
    const afterMove = editor
      .render(80)
      .map((l) => stripVTControlCharacters(l))
      .join("\n");
    assert.ok(!afterMove.includes("repo"), "stale argument menu must not survive the cursor move");
    assert.ok(
      !afterMove.includes("message"),
      "stale argument menu must not survive the cursor move",
    );
  });
}

describe("Editor component", () => {
  describe("Autocomplete", () => {
    it("debounces # autocomplete while typing", async () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      let suggestionCalls = 0;

      const mockProvider: AutocompleteProvider = {
        getSuggestions: (lines, _cursorLine, cursorCol) => {
          suggestionCalls += 1;
          const text = (lines[0] || "").slice(0, cursorCol);
          return Promise.resolve({
            items: [{ value: "#2983", label: "#2983" }],
            prefix: text,
          });
        },
        applyCompletion,
      };

      editor.setAutocompleteProvider(mockProvider);

      typeText(editor, "#298");

      assert.strictEqual(suggestionCalls, 0);
      assert.strictEqual(editor.isShowingAutocomplete(), false);

      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      await flushAutocomplete();

      assert.strictEqual(suggestionCalls, 1);
      assert.strictEqual(editor.isShowingAutocomplete(), true);
    });
  });
});

describe("Editor component", () => {
  describe("Autocomplete", () => {
    it("debounces custom triggerCharacters autocomplete while typing", async () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      let suggestionCalls = 0;

      editor.setAutocompleteProvider({
        triggerCharacters: ["$"],
        getSuggestions: (lines, _cursorLine, cursorCol) => {
          suggestionCalls += 1;
          const prefix = (lines[0] || "").slice(0, cursorCol);
          return Promise.resolve({
            items: [{ value: "$skill-name", label: "skill-name" }],
            prefix,
          });
        },
        applyCompletion,
      });

      typeText(editor, "$sk");

      assert.strictEqual(suggestionCalls, 0);
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      await flushAutocomplete();

      assert.strictEqual(suggestionCalls, 1);
      assert.strictEqual(editor.isShowingAutocomplete(), true);
    });
  });
});

describe("Editor component", () => {
  describe("Autocomplete", () => {
    it("resets custom triggerCharacters when provider changes", async () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      let suggestionCalls = 0;

      editor.setAutocompleteProvider({
        triggerCharacters: ["$"],
        getSuggestions: () =>
          Promise.resolve({
            items: [{ value: "$skill-name", label: "skill-name" }],
            prefix: "$",
          }),
        applyCompletion,
      });
      editor.setAutocompleteProvider({
        getSuggestions: () => {
          suggestionCalls += 1;
          return Promise.resolve({
            items: [{ value: "$skill-name", label: "skill-name" }],
            prefix: "$",
          });
        },
        applyCompletion,
      });

      editor.handleInput("$");
      editor.handleInput("s");
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      await flushAutocomplete();

      assert.strictEqual(suggestionCalls, 0);
      assert.strictEqual(editor.isShowingAutocomplete(), false);
    });
  });
});

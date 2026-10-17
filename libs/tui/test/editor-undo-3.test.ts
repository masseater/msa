import assert from "node:assert";
import { describe, it } from "node:test";

import { type AutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { applyCompletion, createTestTUI, flushAutocomplete, typeText } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Undo", () => {
    it("exits history browsing mode on undo", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("hello");
      assert.strictEqual(editor.getText(), "");

      typeText(editor, "world");
      assert.strictEqual(editor.getText(), "world");

      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "");

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "hello");

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "");

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "world");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    undoCases5();
  });
});

function undoCases5(): void {
  it("undo restores to pre-history state even after multiple history navigations", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.addToHistory("first");
    editor.addToHistory("second");
    editor.addToHistory("third");

    typeText(editor, "current");
    assert.strictEqual(editor.getText(), "current");

    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "");

    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getText(), "third");
    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getText(), "second");
    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getText(), "first");

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "");

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "current");
  });
}

describe("Editor component", () => {
  describe("Undo", () => {
    it("cursor movement starts new undo unit", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      typeText(editor, "hello world");
      assert.strictEqual(editor.getText(), "hello world");

      for (let i = 0; i < 5; i++) editor.handleInput("\x1b[D");

      typeText(editor, "lol");
      assert.strictEqual(editor.getText(), "hello lolworld");

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello world");

      editor.handleInput("|");
      assert.strictEqual(editor.getText(), "hello |world");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("no-op delete operations do not push undo snapshots", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      typeText(editor, "hello");
      assert.strictEqual(editor.getText(), "hello");

      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "");
      editor.handleInput("\x17");
      editor.handleInput("\x17");

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("undoes autocomplete", async () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      const mockProvider: AutocompleteProvider = {
        getSuggestions: (lines, _cursorLine, cursorCol) => {
          const text = lines[0] || "";
          const prefix = text.slice(0, cursorCol);
          if (prefix === "di") {
            return Promise.resolve({
              items: [{ value: "dist/", label: "dist/" }],
              prefix: "di",
            });
          }
          return Promise.resolve(null);
        },
        applyCompletion,
      };

      editor.setAutocompleteProvider(mockProvider);

      editor.handleInput("d");
      editor.handleInput("i");
      assert.strictEqual(editor.getText(), "di");

      editor.handleInput("\t");
      await flushAutocomplete();
      assert.strictEqual(editor.getText(), "dist/");
      assert.strictEqual(editor.isShowingAutocomplete(), false);

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "di");
    });
  });
});

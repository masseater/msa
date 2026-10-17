import assert from "node:assert";
import { describe, it } from "node:test";

import { Input } from "../src/components/input.ts";

describe("Input component", () => {
  describe("Kill ring", () => {
    it("backward deletions prepend, forward deletions append during accumulation", () => {
      const input = new Input();

      input.setValue("prefix|suffix");
      // Position cursor at "|"
      // Ctrl+A
      input.handleInput("\x01");
      // Move right 6
      for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

      // Ctrl+K - deletes "|suffix" (forward)
      input.handleInput("\x0b");
      assert.strictEqual(input.getValue(), "prefix");

      // Ctrl+Y
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "prefix|suffix");
    });

    it("Alt+D deletes word forward and saves to kill ring", () => {
      const input = new Input();

      input.setValue("hello world test");
      // Ctrl+A
      input.handleInput("\x01");

      // Alt+D - deletes "hello"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), " world test");

      // Alt+D - deletes " world"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), " test");

      // Yank should get accumulated text
      // Ctrl+Y
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "hello world test");
    });
  });
});

describe("Input component", () => {
  describe("Kill ring", () => {
    it("Alt+D preserves ASCII punctuation boundaries", () => {
      const input = new Input();

      input.setValue("foo.bar baz");
      // Ctrl+A
      input.handleInput("\x01");
      // Alt+D - deletes "foo"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), ".bar baz");
      // Alt+D - deletes "."
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "bar baz");
      // Alt+D - deletes "bar"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), " baz");
    });
  });
});

describe("Input component", () => {
  describe("Kill ring", () => {
    it("Alt+D handles Unicode word boundaries", () => {
      const input = new Input();

      // "你好世界。你好，世界" segments as: 你好|世界|。|你好|，|世界
      input.setValue("你好世界。你好，世界");
      // Ctrl+A
      input.handleInput("\x01");
      // Alt+D - deletes "你好"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "世界。你好，世界");
      // Alt+D - deletes "世界"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "。你好，世界");
      // Alt+D - deletes "。"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "你好，世界");
      // Alt+D - deletes "你好"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "，世界");
      // Alt+D - deletes "，"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "世界");
      // Alt+D - deletes "世界"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "");
    });
  });
});

describe("Input component", () => {
  describe("Kill ring", () => {
    it("handles yank in middle of text", () => {
      const input = new Input();

      input.setValue("word");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "word"
      input.handleInput("\x17");
      input.setValue("hello world");
      // Move to middle (after "hello ")
      // Ctrl+A
      input.handleInput("\x01");
      for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

      // Ctrl+Y
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "hello wordworld");
    });
  });
});

describe("Input component", () => {
  describe("Kill ring", () => {
    it("handles yank-pop in middle of text", () => {
      const input = new Input();

      // Create two kill ring entries
      input.setValue("FIRST");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "FIRST"
      input.handleInput("\x17");
      input.setValue("SECOND");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "SECOND"
      input.handleInput("\x17");

      // Set up "hello world" and position cursor after "hello "
      input.setValue("hello world");
      // Ctrl+A
      input.handleInput("\x01");
      for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

      // Ctrl+Y - yanks "SECOND"
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "hello SECONDworld");

      // Alt+Y - replaces with "FIRST"
      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "hello FIRSTworld");
    });
  });
});

describe("Input component", () => {
  describe("Undo", () => {
    it("does nothing when undo stack is empty", () => {
      const input = new Input();

      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "");
    });

    it("coalesces consecutive word characters into one undo unit", () => {
      const input = new Input();

      input.handleInput("h");
      input.handleInput("e");
      input.handleInput("l");
      input.handleInput("l");
      input.handleInput("o");
      input.handleInput(" ");
      input.handleInput("w");
      input.handleInput("o");
      input.handleInput("r");
      input.handleInput("l");
      input.handleInput("d");
      assert.strictEqual(input.getValue(), "hello world");

      // Undo removes " world"
      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello");

      // Undo removes "hello"
      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "");
    });
  });
});

describe("Input component", () => {
  describe("Undo", () => {
    it("undoes spaces one at a time", () => {
      const input = new Input();

      input.handleInput("h");
      input.handleInput("e");
      input.handleInput("l");
      input.handleInput("l");
      input.handleInput("o");
      input.handleInput(" ");
      input.handleInput(" ");
      assert.strictEqual(input.getValue(), "hello  ");

      // Ctrl+- (undo) - removes second " "
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello ");

      // Ctrl+- (undo) - removes first " "
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello");

      // Ctrl+- (undo) - removes "hello"
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "");
    });

    it("undoes backspace", () => {
      const input = new Input();

      input.handleInput("h");
      input.handleInput("e");
      input.handleInput("l");
      input.handleInput("l");
      input.handleInput("o");
      // Backspace
      input.handleInput("\x7f");
      assert.strictEqual(input.getValue(), "hell");

      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello");
    });
  });
});

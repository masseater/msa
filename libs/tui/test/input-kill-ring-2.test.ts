import assert from "node:assert";
import { describe, it } from "node:test";

import { Input } from "../src/components/input.ts";
import { typeText } from "./editor-helpers.ts";

describe("Input component", () => {
  describe("Kill ring", () => {
    it("backward deletions prepend, forward deletions append during accumulation", () => {
      const input = new Input();

      input.setValue("prefix|suffix");
      input.handleInput("\x01");
      for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

      input.handleInput("\x0b");
      assert.strictEqual(input.getValue(), "prefix");

      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "prefix|suffix");
    });

    it("Alt+D deletes word forward and saves to kill ring", () => {
      const input = new Input();

      input.setValue("hello world test");
      input.handleInput("\x01");

      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), " world test");

      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), " test");

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
      input.handleInput("\x01");
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), ".bar baz");
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "bar baz");
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), " baz");
    });
  });
});

describe("Input component", () => {
  describe("Kill ring", () => {
    it("Alt+D handles Unicode word boundaries", () => {
      const input = new Input();

      input.setValue("你好世界。你好，世界");
      input.handleInput("\x01");
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "世界。你好，世界");
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "。你好，世界");
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "你好，世界");
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "，世界");
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "世界");
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
      input.handleInput("\x05");
      input.handleInput("\x17");
      input.setValue("hello world");
      input.handleInput("\x01");
      for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "hello wordworld");
    });
  });
});

describe("Input component", () => {
  describe("Kill ring", () => {
    it("handles yank-pop in middle of text", () => {
      const input = new Input();

      input.setValue("FIRST");
      input.handleInput("\x05");
      input.handleInput("\x17");
      input.setValue("SECOND");
      input.handleInput("\x05");
      input.handleInput("\x17");

      input.setValue("hello world");
      input.handleInput("\x01");
      for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "hello SECONDworld");

      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "hello FIRSTworld");
    });
  });
});

describe("Input component", () => {
  describe("Undo", () => {
    it("does nothing when undo stack is empty", () => {
      const input = new Input();

      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "");
    });

    it("coalesces consecutive word characters into one undo unit", () => {
      const input = new Input();

      typeText(input, "hello world");
      assert.strictEqual(input.getValue(), "hello world");

      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello");

      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "");
    });
  });
});

describe("Input component", () => {
  describe("Undo", () => {
    it("undoes spaces one at a time", () => {
      const input = new Input();

      typeText(input, "hello  ");
      assert.strictEqual(input.getValue(), "hello  ");

      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello ");

      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello");

      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "");
    });

    it("undoes backspace", () => {
      const input = new Input();

      typeText(input, "hello");
      input.handleInput("\x7f");
      assert.strictEqual(input.getValue(), "hell");

      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello");
    });
  });
});

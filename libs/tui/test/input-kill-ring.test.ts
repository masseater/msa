import assert from "node:assert";
import { describe, it } from "node:test";

import { Input } from "../src/components/input.ts";

describe("Input component", () => {
  describe("Kill ring", () => {
    it("Alt+Y cycles through kill ring after Ctrl+Y", () => {
      const input = new Input();

      input.setValue("first");
      input.handleInput("\x05");
      input.handleInput("\x17");
      input.setValue("second");
      input.handleInput("\x05");
      input.handleInput("\x17");
      input.setValue("third");
      input.handleInput("\x05");
      input.handleInput("\x17");

      assert.strictEqual(input.getValue(), "");

      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "third");

      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "second");

      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "first");

      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "third");
    });
  });
});

describe("Input component", () => {
  describe("Kill ring", () => {
    it("Alt+Y does nothing if not preceded by yank", () => {
      const input = new Input();

      input.setValue("test");
      input.handleInput("\x05");
      input.handleInput("\x17");
      input.setValue("other");
      input.handleInput("\x05");

      input.handleInput("x");
      assert.strictEqual(input.getValue(), "otherx");

      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "otherx");
    });

    it("Alt+Y does nothing if kill ring has one entry", () => {
      const input = new Input();

      input.setValue("only");
      input.handleInput("\x05");
      input.handleInput("\x17");

      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "only");

      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "only");
    });
  });
});

describe("Input component", () => {
  describe("Kill ring", () => {
    it("consecutive Ctrl+W accumulates into one kill ring entry", () => {
      const input = new Input();

      input.setValue("one two three");
      input.handleInput("\x05");
      input.handleInput("\x17");
      input.handleInput("\x17");
      input.handleInput("\x17");

      assert.strictEqual(input.getValue(), "");

      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "one two three");
    });
  });
});

describe("Input component", () => {
  describe("Kill ring", () => {
    it("non-delete actions break kill accumulation", () => {
      const input = new Input();

      input.setValue("foo bar baz");
      input.handleInput("\x05");
      input.handleInput("\x17");
      assert.strictEqual(input.getValue(), "foo bar ");

      input.handleInput("x");
      assert.strictEqual(input.getValue(), "foo bar x");

      input.handleInput("\x17");
      assert.strictEqual(input.getValue(), "foo bar ");

      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "foo bar x");

      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "foo bar baz");
    });
  });
});

describe("Input component", () => {
  describe("Kill ring", () => {
    it("non-yank actions break Alt+Y chain", () => {
      const input = new Input();

      input.setValue("first");
      input.handleInput("\x05");
      input.handleInput("\x17");
      input.setValue("second");
      input.handleInput("\x05");
      input.handleInput("\x17");
      input.setValue("");

      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "second");

      input.handleInput("x");
      assert.strictEqual(input.getValue(), "secondx");

      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "secondx");
    });
  });
});

describe("Input component", () => {
  describe("Kill ring", () => {
    it("kill ring rotation persists after cycling", () => {
      const input = new Input();

      input.setValue("first");
      input.handleInput("\x05");
      input.handleInput("\x17");
      input.setValue("second");
      input.handleInput("\x05");
      input.handleInput("\x17");
      input.setValue("third");
      input.handleInput("\x05");
      input.handleInput("\x17");
      input.setValue("");

      input.handleInput("\x19");
      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "second");

      input.handleInput("x");
      input.setValue("");

      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "second");
    });
  });
});

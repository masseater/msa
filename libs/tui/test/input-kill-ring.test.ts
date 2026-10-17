import assert from "node:assert";
import { describe, it } from "node:test";

import { Input } from "../src/components/input.ts";

describe("Input component", () => {
  describe("Kill ring", () => {
    it("Alt+Y cycles through kill ring after Ctrl+Y", () => {
      const input = new Input();

      // Create kill ring with multiple entries
      input.setValue("first");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "first"
      input.handleInput("\x17");
      input.setValue("second");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "second"
      input.handleInput("\x17");
      input.setValue("third");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "third"
      input.handleInput("\x17");

      assert.strictEqual(input.getValue(), "");

      // Ctrl+Y - yanks "third"
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "third");

      // Alt+Y - cycles to "second"
      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "second");

      // Alt+Y - cycles to "first"
      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "first");

      // Alt+Y - cycles back to "third"
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
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "test"
      input.handleInput("\x17");
      input.setValue("other");
      // Ctrl+E
      input.handleInput("\x05");

      // Type something to break the yank chain
      input.handleInput("x");
      assert.strictEqual(input.getValue(), "otherx");

      // Alt+Y - should do nothing
      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "otherx");
    });

    it("Alt+Y does nothing if kill ring has one entry", () => {
      const input = new Input();

      input.setValue("only");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "only"
      input.handleInput("\x17");

      // Ctrl+Y - yanks "only"
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "only");

      // Alt+Y - should do nothing
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
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "three"
      input.handleInput("\x17");
      // Ctrl+W - deletes "two "
      input.handleInput("\x17");
      // Ctrl+W - deletes "one "
      input.handleInput("\x17");

      assert.strictEqual(input.getValue(), "");

      // Ctrl+Y
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
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "baz"
      input.handleInput("\x17");
      assert.strictEqual(input.getValue(), "foo bar ");

      // Typing breaks accumulation
      input.handleInput("x");
      assert.strictEqual(input.getValue(), "foo bar x");

      // Ctrl+W - deletes "x" (separate entry)
      input.handleInput("\x17");
      assert.strictEqual(input.getValue(), "foo bar ");

      // Ctrl+Y - most recent is "x"
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "foo bar x");

      // Alt+Y - cycle to "baz"
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
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W
      input.handleInput("\x17");
      input.setValue("second");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W
      input.handleInput("\x17");
      input.setValue("");

      // Ctrl+Y - yanks "second"
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "second");

      // Breaks yank chain
      input.handleInput("x");
      assert.strictEqual(input.getValue(), "secondx");

      // Alt+Y - should do nothing
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
      // Ctrl+E
      input.handleInput("\x05");
      // deletes "first"
      input.handleInput("\x17");
      input.setValue("second");
      // Ctrl+E
      input.handleInput("\x05");
      // deletes "second"
      input.handleInput("\x17");
      input.setValue("third");
      // Ctrl+E
      input.handleInput("\x05");
      // deletes "third"
      input.handleInput("\x17");
      input.setValue("");

      // Ctrl+Y - yanks "third"
      input.handleInput("\x19");
      // Alt+Y - cycles to "second"
      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "second");

      // Break chain and start fresh
      input.handleInput("x");
      input.setValue("");

      // New yank should get "second" (now at end after rotation)
      // Ctrl+Y
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "second");
    });
  });
});

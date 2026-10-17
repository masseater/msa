import assert from "node:assert";
import { describe, it } from "node:test";

import { Input } from "../src/components/input.ts";
import { typeText } from "./editor-helpers.ts";

describe("Input component", () => {
  describe("Undo", () => {
    it("undoes forward delete", () => {
      const input = new Input();

      typeText(input, "hello");
      // Ctrl+A - go to start
      input.handleInput("\x01");
      // Right arrow
      input.handleInput("\x1b[C");
      // Delete key
      input.handleInput("\x1b[3~");
      assert.strictEqual(input.getValue(), "hllo");

      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello");
    });
  });
});

describe("Input component", () => {
  describe("Undo", () => {
    it("undoes Ctrl+W (delete word backward)", () => {
      const input = new Input();

      typeText(input, "hello world");
      assert.strictEqual(input.getValue(), "hello world");

      // Ctrl+W
      input.handleInput("\x17");
      assert.strictEqual(input.getValue(), "hello ");

      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello world");
    });
  });
});

describe("Input component", () => {
  describe("Undo", () => {
    it("undoes Ctrl+K (delete to line end)", () => {
      const input = new Input();

      typeText(input, "hello world");
      // Ctrl+A
      input.handleInput("\x01");
      for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

      // Ctrl+K
      input.handleInput("\x0b");
      assert.strictEqual(input.getValue(), "hello ");

      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello world");
    });
  });
});

describe("Input component", () => {
  describe("Undo", () => {
    it("undoes Ctrl+U (delete to line start)", () => {
      const input = new Input();

      typeText(input, "hello world");
      // Ctrl+A
      input.handleInput("\x01");
      for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

      // Ctrl+U
      input.handleInput("\x15");
      assert.strictEqual(input.getValue(), "world");

      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello world");
    });
  });
});

describe("Input component", () => {
  describe("Undo", () => {
    it("undoes yank", () => {
      const input = new Input();

      typeText(input, "hello ");
      // Ctrl+W - delete "hello "
      input.handleInput("\x17");
      // Ctrl+Y - yank
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "hello ");

      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "");
    });

    it("undoes paste atomically", () => {
      const input = new Input();

      input.setValue("hello world");
      // Ctrl+A
      input.handleInput("\x01");
      for (let i = 0; i < 5; i++) input.handleInput("\x1b[C");

      // Simulate bracketed paste
      input.handleInput("\x1b[200~beep boop\x1b[201~");
      assert.strictEqual(input.getValue(), "hellobeep boop world");

      // Single undo should restore entire pre-paste state
      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello world");
    });
  });
});

describe("Input component", () => {
  describe("Undo", () => {
    it("undoes Alt+D (delete word forward)", () => {
      const input = new Input();

      input.setValue("hello world");
      // Ctrl+A
      input.handleInput("\x01");

      // Alt+D - deletes "hello"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), " world");

      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello world");
    });

    it("cursor movement starts new undo unit", () => {
      const input = new Input();

      typeText(input, "abc");
      // Ctrl+A - movement breaks coalescing
      input.handleInput("\x01");
      // Ctrl+E
      input.handleInput("\x05");
      input.handleInput("d");
      input.handleInput("e");
      assert.strictEqual(input.getValue(), "abcde");

      // Undo removes "de" (typed after movement)
      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "abc");

      // Undo removes "abc"
      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "");
    });
  });
});

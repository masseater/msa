import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";

import { StdinBuffer } from "../src/stdin-buffer.ts";
import { wait } from "./stdin-buffer-helpers.ts";

describe("StdinBuffer", () => {
  let buffer: StdinBuffer;
  let emittedSequences: string[];
  beforeEach(() => {
    buffer = new StdinBuffer({ timeout: 10 });

    // Collect emitted sequences
    emittedSequences = [];
    buffer.on("data", (sequence) => {
      emittedSequences.push(sequence);
    });
  });
  afterEach(() => buffer.destroy());
  // Helper to process data through the buffer
  function processInput(data: string | Buffer): void {
    buffer.process(data);
  }
  describe("Bracketed Paste", () => {
    let emittedPaste: string[] = [];
    beforeEach(() => {
      buffer = new StdinBuffer({ timeout: 10 });

      // Collect emitted sequences
      emittedSequences = [];
      buffer.on("data", (sequence) => {
        emittedSequences.push(sequence);
      });

      // Collect paste events
      emittedPaste = [];
      buffer.on("paste", (data) => {
        emittedPaste.push(data);
      });
    });
    it("should handle paste with newlines", () => {
      processInput("\x1b[200~line1\nline2\nline3\x1b[201~");

      assert.deepStrictEqual(emittedPaste, ["line1\nline2\nline3"]);
      assert.deepStrictEqual(emittedSequences, []);
    });
  });
});

describe("StdinBuffer", () => {
  let buffer: StdinBuffer;
  let emittedSequences: string[];
  beforeEach(() => {
    buffer = new StdinBuffer({ timeout: 10 });

    // Collect emitted sequences
    emittedSequences = [];
    buffer.on("data", (sequence) => {
      emittedSequences.push(sequence);
    });
  });
  afterEach(() => buffer.destroy());
  // Helper to process data through the buffer
  function processInput(data: string | Buffer): void {
    buffer.process(data);
  }
  describe("Bracketed Paste", () => {
    let emittedPaste: string[] = [];
    beforeEach(() => {
      buffer = new StdinBuffer({ timeout: 10 });

      // Collect emitted sequences
      emittedSequences = [];
      buffer.on("data", (sequence) => {
        emittedSequences.push(sequence);
      });

      // Collect paste events
      emittedPaste = [];
      buffer.on("paste", (data) => {
        emittedPaste.push(data);
      });
    });
    it("should handle paste with unicode", () => {
      processInput("\x1b[200~Hello 世界 🎉\x1b[201~");

      assert.deepStrictEqual(emittedPaste, ["Hello 世界 🎉"]);
      assert.deepStrictEqual(emittedSequences, []);
    });
  });
});

describe("StdinBuffer", () => {
  let buffer: StdinBuffer;
  let emittedSequences: string[];
  beforeEach(() => {
    buffer = new StdinBuffer({ timeout: 10 });

    // Collect emitted sequences
    emittedSequences = [];
    buffer.on("data", (sequence) => {
      emittedSequences.push(sequence);
    });
  });
  afterEach(() => buffer.destroy());
  // Helper to process data through the buffer
  function processInput(data: string | Buffer): void {
    buffer.process(data);
  }
  describe("Destroy", () => {
    it("should clear buffer on destroy", () => {
      processInput("\x1b[<35");
      assert.strictEqual(buffer.getBuffer(), "\x1b[<35");

      buffer.destroy();
      assert.strictEqual(buffer.getBuffer(), "");
    });

    it("should clear pending timeouts on destroy", async () => {
      processInput("\x1b[<35");
      buffer.destroy();

      // Wait longer than timeout
      await wait(15);

      // Should not have emitted anything
      assert.deepStrictEqual(emittedSequences, []);
    });
  });
});

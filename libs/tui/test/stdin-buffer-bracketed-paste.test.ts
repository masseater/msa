import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";

import { Effect } from "effect";

import { StdinBuffer } from "../src/stdin-buffer.ts";
import stdinBufferHelpers from "./stdin-buffer-helpers.ts";

const { wait } = stdinBufferHelpers;

describe("StdinBuffer", () => {
  let buffer: StdinBuffer;
  let emittedSequences: string[];
  beforeEach(() => {
    buffer = new StdinBuffer({ timeout: 10 });

    emittedSequences = [];
    buffer.on("data", (sequence) => {
      emittedSequences.push(sequence);
    });
  });
  afterEach(() => buffer.destroy());
  function processInput(data: string | Buffer): void {
    buffer.process(data);
  }
  describe("Bracketed Paste", () => {
    let emittedPaste: string[] = [];
    beforeEach(() => {
      buffer = new StdinBuffer({ timeout: 10 });

      emittedSequences = [];
      buffer.on("data", (sequence) => {
        emittedSequences.push(sequence);
      });

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

    emittedSequences = [];
    buffer.on("data", (sequence) => {
      emittedSequences.push(sequence);
    });
  });
  afterEach(() => buffer.destroy());
  function processInput(data: string | Buffer): void {
    buffer.process(data);
  }
  describe("Bracketed Paste", () => {
    let emittedPaste: string[] = [];
    beforeEach(() => {
      buffer = new StdinBuffer({ timeout: 10 });

      emittedSequences = [];
      buffer.on("data", (sequence) => {
        emittedSequences.push(sequence);
      });

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

    emittedSequences = [];
    buffer.on("data", (sequence) => {
      emittedSequences.push(sequence);
    });
  });
  afterEach(() => buffer.destroy());
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

    it("should clear pending timeouts on destroy", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          processInput("\x1b[<35");
          buffer.destroy();

          yield* wait(15);

          assert.deepStrictEqual(emittedSequences, []);
        }),
      ));
  });
});

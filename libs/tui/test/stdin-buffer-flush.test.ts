import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";

import { Effect } from "effect";

import StdinBuffer from "../src/stdin-buffer.ts";
import type stdinBufferTypes from "../src/stdin-buffer.types.ts";
import stdinBufferHelpers from "./stdin-buffer-helpers.ts";

const { wait } = stdinBufferHelpers;

describe("StdinBuffer", () => {
  let buffer: stdinBufferTypes.StdinBuffer;
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
  describe("Flush", () => {
    it("should flush incomplete sequences", () => {
      processInput("\x1b[<35");
      const flushed = buffer.flush();
      assert.deepStrictEqual(flushed, ["\x1b[<35"]);
      assert.strictEqual(buffer.getBuffer(), "");
    });

    it("should return empty array if nothing to flush", () => {
      const flushed = buffer.flush();
      assert.deepStrictEqual(flushed, []);
    });

    it("should emit flushed data via timeout", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          processInput("\x1b[<35");
          assert.deepStrictEqual(emittedSequences, []);

          yield* wait(15);

          assert.deepStrictEqual(emittedSequences, ["\x1b[<35"]);
        }),
      ));
  });
});

describe("StdinBuffer", () => {
  let buffer: stdinBufferTypes.StdinBuffer;
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
  describe("Clear", () => {
    it("should clear buffered content without emitting", () => {
      processInput("\x1b[<35");
      assert.strictEqual(buffer.getBuffer(), "\x1b[<35");

      buffer.clear();
      assert.strictEqual(buffer.getBuffer(), "");
      assert.deepStrictEqual(emittedSequences, []);
    });
  });
});

describe("StdinBuffer", () => {
  describe("Bracketed Paste", () => {
    bracketedPasteCases2();
  });
});

function bracketedPasteCases2(): void {
  let buffer: stdinBufferTypes.StdinBuffer;
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
  it("should emit paste event for complete bracketed paste", () => {
    const pasteStart = "\x1b[200~";
    const pasteEnd = "\x1b[201~";
    const content = "hello world";

    processInput(pasteStart + content + pasteEnd);

    assert.deepStrictEqual(emittedPaste, ["hello world"]);
    assert.deepStrictEqual(emittedSequences, []);
  });
}

describe("StdinBuffer", () => {
  describe("Bracketed Paste", () => {
    bracketedPasteCases3();
  });
});

function bracketedPasteCases3(): void {
  let buffer: stdinBufferTypes.StdinBuffer;
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
  it("should handle paste arriving in chunks", () => {
    processInput("\x1b[200~");
    assert.deepStrictEqual(emittedPaste, []);

    processInput("hello ");
    assert.deepStrictEqual(emittedPaste, []);

    processInput("world\x1b[201~");
    assert.deepStrictEqual(emittedPaste, ["hello world"]);
    assert.deepStrictEqual(emittedSequences, []);
  });
}

describe("StdinBuffer", () => {
  let buffer: stdinBufferTypes.StdinBuffer;
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
    it("should handle paste with input before and after", () => {
      processInput("a");
      processInput("\x1b[200~pasted\x1b[201~");
      processInput("b");

      assert.deepStrictEqual(emittedSequences, ["a", "b"]);
      assert.deepStrictEqual(emittedPaste, ["pasted"]);
    });
  });
});

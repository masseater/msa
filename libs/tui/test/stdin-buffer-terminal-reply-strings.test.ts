import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";

import { StdinBuffer } from "../src/stdin-buffer.ts";
import { replies } from "./stdin-buffer-helpers.ts";

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
  describe("Terminal Reply Strings", () => {
    it("recognizes a reply header assembled within the ambiguous-input timeout", (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      processInput("\x1b]1");
      t.mock.timers.tick(5);
      processInput("0;");
      t.mock.timers.tick(5000);
      assert.deepStrictEqual(emittedSequences, []);
      processInput("rgb:ffff/ffff/ffff\x1b\\");
      assert.deepStrictEqual(emittedSequences, [replies[1]?.reply]);
    });

    it("recovers from an unterminated reply when a new escape sequence arrives", (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      processInput("\x1b]4;1;rgb:eaea/6c");
      t.mock.timers.tick(100);
      processInput("\x1b");
      t.mock.timers.tick(100);
      processInput("[Ahello");
      assert.deepStrictEqual(emittedSequences, ["\x1b[A", "h", "e", "l", "l", "o"]);
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
  describe("Terminal Reply Strings", () => {
    it("discards a canceled reply without swallowing subsequent input", () => {
      for (const cancel of ["\x18", "\x1a"]) {
        processInput(`\x1b]11;rgb:0000${cancel}x`);
      }
      assert.deepStrictEqual(emittedSequences, ["x", "x"]);
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
  describe("Mixed Content", () => {
    it("should handle characters followed by escape sequence", () => {
      processInput("abc\x1b[A");
      assert.deepStrictEqual(emittedSequences, ["a", "b", "c", "\x1b[A"]);
    });

    it("should handle escape sequence followed by characters", () => {
      processInput("\x1b[Aabc");
      assert.deepStrictEqual(emittedSequences, ["\x1b[A", "a", "b", "c"]);
    });

    it("should handle multiple complete sequences", () => {
      processInput("\x1b[A\x1b[B\x1b[C");
      assert.deepStrictEqual(emittedSequences, ["\x1b[A", "\x1b[B", "\x1b[C"]);
    });

    it("should handle partial sequence with preceding characters", () => {
      processInput("abc\x1b[<35");
      assert.deepStrictEqual(emittedSequences, ["a", "b", "c"]);
      assert.strictEqual(buffer.getBuffer(), "\x1b[<35");

      processInput(";20;5m");
      assert.deepStrictEqual(emittedSequences, ["a", "b", "c", "\x1b[<35;20;5m"]);
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
  describe("Kitty Keyboard Protocol", () => {
    it("should handle Kitty CSI u press events", () => {
      // Press 'a' in Kitty protocol
      processInput("\x1b[97u");
      assert.deepStrictEqual(emittedSequences, ["\x1b[97u"]);
    });

    it("should handle Kitty CSI u release events", () => {
      // Release 'a' in Kitty protocol
      processInput("\x1b[97;1:3u");
      assert.deepStrictEqual(emittedSequences, ["\x1b[97;1:3u"]);
    });

    it("should handle batched Kitty press and release", () => {
      // Press 'a', release 'a' batched together (common over SSH)
      processInput("\x1b[97u\x1b[97;1:3u");
      assert.deepStrictEqual(emittedSequences, ["\x1b[97u", "\x1b[97;1:3u"]);
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
  describe("Kitty Keyboard Protocol", () => {
    it("should handle multiple batched Kitty events", () => {
      // Press 'a', release 'a', press 'b', release 'b'
      processInput("\x1b[97u\x1b[97;1:3u\x1b[98u\x1b[98;1:3u");
      assert.deepStrictEqual(emittedSequences, [
        "\x1b[97u",
        "\x1b[97;1:3u",
        "\x1b[98u",
        "\x1b[98;1:3u",
      ]);
    });

    it("should handle Kitty arrow keys with event type", () => {
      // Up arrow press with event type
      processInput("\x1b[1;1:1A");
      assert.deepStrictEqual(emittedSequences, ["\x1b[1;1:1A"]);
    });

    it("should handle Kitty functional keys with event type", () => {
      // Delete key release
      processInput("\x1b[3;1:3~");
      assert.deepStrictEqual(emittedSequences, ["\x1b[3;1:3~"]);
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
  describe("Kitty Keyboard Protocol", () => {
    it("should split ESC+ESC+CSI into standalone ESC and the CSI sequence (WezTerm Escape key regression)", () => {
      // WezTerm with enable_kitty_keyboard sends Escape key press as raw \x1b
      // and the release as a full Kitty CSI-u sequence, concatenated.
      // The buffer must not treat \x1b\x1b as a complete meta-key when the
      // following byte starts a new escape sequence.
      processInput("\x1b\x1b[27;129:3u");
      assert.deepStrictEqual(emittedSequences, ["\x1b", "\x1b[27;129:3u"]);
    });

    it("should split ESC+ESC+CSI with no modifier (no num_lock)", () => {
      processInput("\x1b\x1b[27;1:3u");
      assert.deepStrictEqual(emittedSequences, ["\x1b", "\x1b[27;1:3u"]);
    });

    it("should still emit ESC+ESC as a single sequence when not followed by a new escape", () => {
      // \x1b\x1b alone (no following CSI) stays as-is — e.g. ctrl+alt+[
      processInput("\x1b\x1b");
      assert.deepStrictEqual(emittedSequences, ["\x1b\x1b"]);
    });

    it("should handle plain characters mixed with Kitty sequences", () => {
      // Plain 'a' followed by Kitty release
      processInput("a\x1b[97;1:3u");
      assert.deepStrictEqual(emittedSequences, ["a", "\x1b[97;1:3u"]);
    });
  });
});

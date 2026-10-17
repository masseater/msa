import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";

import { StdinBuffer } from "../src/stdin-buffer.ts";
import { wait } from "./stdin-buffer-helpers.ts";

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
  describe("Kitty Keyboard Protocol", () => {
    it("should drop raw duplicate character after matching Kitty printable sequence", () => {
      processInput("\x1b[224uà");
      assert.deepStrictEqual(emittedSequences, ["\x1b[224u"]);
    });

    it("should drop raw duplicate character after matching Kitty printable sequence across chunks", () => {
      processInput("\x1b[64u");
      processInput("@");
      assert.deepStrictEqual(emittedSequences, ["\x1b[64u"]);
    });

    it("should keep non-matching plain character after Kitty printable sequence", () => {
      processInput("\x1b[97ub");
      assert.deepStrictEqual(emittedSequences, ["\x1b[97u", "b"]);
    });

    it("should keep raw character after modified Kitty printable sequence", () => {
      processInput("\x1b[64;3u@");
      assert.deepStrictEqual(emittedSequences, ["\x1b[64;3u", "@"]);
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
  describe("Kitty Keyboard Protocol", () => {
    it("should handle rapid typing simulation with Kitty protocol", () => {
      processInput("\x1b[104u\x1b[104;1:3u\x1b[105u\x1b[105;1:3u");
      assert.deepStrictEqual(emittedSequences, [
        "\x1b[104u",
        "\x1b[104;1:3u",
        "\x1b[105u",
        "\x1b[105;1:3u",
      ]);
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
  describe("Mouse Events", () => {
    it("should handle mouse press event", () => {
      processInput("\x1b[<0;10;5M");
      assert.deepStrictEqual(emittedSequences, ["\x1b[<0;10;5M"]);
    });

    it("should handle mouse release event", () => {
      processInput("\x1b[<0;10;5m");
      assert.deepStrictEqual(emittedSequences, ["\x1b[<0;10;5m"]);
    });

    it("should handle mouse move event", () => {
      processInput("\x1b[<35;20;5m");
      assert.deepStrictEqual(emittedSequences, ["\x1b[<35;20;5m"]);
    });

    it("should handle split mouse events", () => {
      processInput("\x1b[<3");
      processInput("5;1");
      processInput("5;");
      processInput("10m");
      assert.deepStrictEqual(emittedSequences, ["\x1b[<35;15;10m"]);
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
  describe("Mouse Events", () => {
    it("should handle multiple mouse events", () => {
      processInput("\x1b[<35;1;1m\x1b[<35;2;2m\x1b[<35;3;3m");
      assert.deepStrictEqual(emittedSequences, ["\x1b[<35;1;1m", "\x1b[<35;2;2m", "\x1b[<35;3;3m"]);
    });

    it("should handle old-style mouse sequence (ESC[M + 3 bytes)", () => {
      processInput("\x1b[M abc");
      assert.deepStrictEqual(emittedSequences, ["\x1b[M ab", "c"]);
    });

    it("should buffer incomplete old-style mouse sequence", () => {
      processInput("\x1b[M");
      assert.strictEqual(buffer.getBuffer(), "\x1b[M");

      processInput(" a");
      assert.strictEqual(buffer.getBuffer(), "\x1b[M a");

      processInput("b");
      assert.deepStrictEqual(emittedSequences, ["\x1b[M ab"]);
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
  describe("Edge Cases", () => {
    it("should handle empty input", () => {
      processInput("");
      assert.deepStrictEqual(emittedSequences, [""]);
    });

    it("should handle lone escape character with timeout", async () => {
      processInput("\x1b");
      assert.deepStrictEqual(emittedSequences, []);

      await wait(15);
      assert.deepStrictEqual(emittedSequences, ["\x1b"]);
    });

    it("flushes a lone escape promptly with the longer default sequence timeout", async () => {
      const defaultBuffer = new StdinBuffer();
      const defaultSequences: string[] = [];
      defaultBuffer.on("data", (sequence) => defaultSequences.push(sequence));

      defaultBuffer.process("\x1b");
      await wait(20);
      assert.deepStrictEqual(defaultSequences, ["\x1b"]);
      defaultBuffer.destroy();
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
  describe("Edge Cases", () => {
    it("should handle lone escape character with explicit flush", () => {
      processInput("\x1b");
      assert.deepStrictEqual(emittedSequences, []);

      const flushed = buffer.flush();
      assert.deepStrictEqual(flushed, ["\x1b"]);
    });

    it("should handle buffer input", () => {
      processInput(Buffer.from("\x1b[A"));
      assert.deepStrictEqual(emittedSequences, ["\x1b[A"]);
    });

    it("should handle very long sequences", () => {
      const longSeq = `\x1b[${"1;".repeat(50)}H`;
      processInput(longSeq);
      assert.deepStrictEqual(emittedSequences, [longSeq]);
    });
  });
});

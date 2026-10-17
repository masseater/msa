import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";

import { matchesKey } from "../src/keys.ts";
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
  describe("Regular Characters", () => {
    it("should pass through regular characters immediately", () => {
      processInput("a");
      assert.deepStrictEqual(emittedSequences, ["a"]);
    });

    it("should pass through multiple regular characters", () => {
      processInput("abc");
      assert.deepStrictEqual(emittedSequences, ["a", "b", "c"]);
    });

    it("should handle unicode characters", () => {
      processInput("hello 世界");
      assert.deepStrictEqual(emittedSequences, ["h", "e", "l", "l", "o", " ", "世", "界"]);
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
  describe("Complete Escape Sequences", () => {
    it("should pass through complete mouse SGR sequences", () => {
      const mouseSeq = "\x1b[<35;20;5m";
      processInput(mouseSeq);
      assert.deepStrictEqual(emittedSequences, [mouseSeq]);
    });

    it("should pass through complete arrow key sequences", () => {
      const upArrow = "\x1b[A";
      processInput(upArrow);
      assert.deepStrictEqual(emittedSequences, [upArrow]);
    });

    it("should pass through complete function key sequences", () => {
      const f1 = "\x1b[11~";
      processInput(f1);
      assert.deepStrictEqual(emittedSequences, [f1]);
    });

    it("should pass through meta key sequences", () => {
      const metaA = "\x1ba";
      processInput(metaA);
      assert.deepStrictEqual(emittedSequences, [metaA]);
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
  describe("Complete Escape Sequences", () => {
    it("should pass through SS3 sequences", () => {
      const ss3 = "\x1bOA";
      processInput(ss3);
      assert.deepStrictEqual(emittedSequences, [ss3]);
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
  describe("Partial Escape Sequences", () => {
    it("should buffer incomplete mouse SGR sequence", () => {
      processInput("\x1b");
      assert.deepStrictEqual(emittedSequences, []);
      assert.strictEqual(buffer.getBuffer(), "\x1b");

      processInput("[<35");
      assert.deepStrictEqual(emittedSequences, []);
      assert.strictEqual(buffer.getBuffer(), "\x1b[<35");

      processInput(";20;5m");
      assert.deepStrictEqual(emittedSequences, ["\x1b[<35;20;5m"]);
      assert.strictEqual(buffer.getBuffer(), "");
    });

    it("should buffer incomplete CSI sequence", () => {
      processInput("\x1b[");
      assert.deepStrictEqual(emittedSequences, []);

      processInput("1;");
      assert.deepStrictEqual(emittedSequences, []);

      processInput("5H");
      assert.deepStrictEqual(emittedSequences, ["\x1b[1;5H"]);
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
  describe("Partial Escape Sequences", () => {
    it("should buffer split across many chunks", () => {
      processInput("\x1b");
      processInput("[");
      processInput("<");
      processInput("3");
      processInput("5");
      processInput(";");
      processInput("2");
      processInput("0");
      processInput(";");
      processInput("5");
      processInput("m");

      assert.deepStrictEqual(emittedSequences, ["\x1b[<35;20;5m"]);
    });

    it("should flush incomplete sequence after timeout", async () => {
      processInput("\x1b[<35");
      assert.deepStrictEqual(emittedSequences, []);

      await wait(15);

      assert.deepStrictEqual(emittedSequences, ["\x1b[<35"]);
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
  describe("Partial Escape Sequences", () => {
    it("should flush a lone ESC as Escape when CR arrives after the timeout", async () => {
      processInput("\x1b");
      await wait(20);
      processInput("\r");

      assert.deepStrictEqual(emittedSequences, ["\x1b", "\r"]);
      assert.equal(matchesKey(emittedSequences[0] ?? "", "escape"), true);
    });
  });
});

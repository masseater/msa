import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";

import { Effect } from "effect";

import { matchesKey } from "../src/keys.ts";
import { StdinBuffer } from "../src/stdin-buffer.ts";
import { replies, wait } from "./stdin-buffer-helpers.ts";

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
    it("should merge ESC + CR split across chunks within a larger timeout", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          buffer = new StdinBuffer({ escapeTimeout: 100 });
          emittedSequences = [];
          buffer.on("data", (sequence) => {
            emittedSequences.push(sequence);
          });

          processInput("\x1b");
          yield* wait(20);
          processInput("\r");

          assert.deepStrictEqual(emittedSequences, ["\x1b\r"]);
          assert.equal(matchesKey(emittedSequences[0] ?? "", "alt+enter"), true);
        }),
      ));
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
    it("does not apply the sequence timeout to a lone ESC", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          buffer = new StdinBuffer({ timeout: 100 });
          emittedSequences = [];
          buffer.on("data", (sequence) => {
            emittedSequences.push(sequence);
          });

          processInput("\x1b");
          yield* wait(20);
          processInput("\r");

          assert.deepStrictEqual(emittedSequences, ["\x1b", "\r"]);
          assert.equal(matchesKey(emittedSequences[0] ?? "", "escape"), true);
        }),
      ));
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
  describe("Partial Escape Sequences", () => {
    it("keeps fragmented mouse sequences buffered across delayed chunks by default", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const delayedBuffer = new StdinBuffer();
          const delayedSequences: string[] = [];
          delayedBuffer.on("data", (sequence) => delayedSequences.push(sequence));

          delayedBuffer.process("\x1b[");
          yield* wait(20);
          assert.deepStrictEqual(delayedSequences, []);
          delayedBuffer.process("<65;48;39M");
          assert.deepStrictEqual(delayedSequences, ["\x1b[<65;48;39M"]);
          delayedBuffer.destroy();
        }),
      ));
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
  describe("Terminal Reply Strings", () => {
    for (const { header, reply } of replies) {
      it(`keeps delayed ${JSON.stringify(reply)} intact at every split after its reply header`, (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        for (let split = header.length; split < reply.length; split++) {
          const delayedBuffer = new StdinBuffer();
          const sequences: string[] = [];
          delayedBuffer.on("data", (sequence) => sequences.push(sequence));
          try {
            delayedBuffer.process(reply.slice(0, split));
            t.mock.timers.tick(5000);
            delayedBuffer.process(`${reply.slice(split)}x`);
            assert.equal(
              sequences.some((sequence) => matchesKey(sequence, "ctrl+g")),
              false,
            );
            assert.deepStrictEqual(sequences, [reply, "x"]);
          } finally {
            delayedBuffer.destroy();
          }
        }
      });
    }
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
  describe("Terminal Reply Strings", () => {
    it("keeps an OSC reply buffered across multiple expired sequence timeouts", (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      processInput("\x1b]4;1;rgb:eaea/6c");
      t.mock.timers.tick(100);
      assert.deepStrictEqual(emittedSequences, []);
      processInput("6c/6d6d");
      t.mock.timers.tick(100);
      assert.deepStrictEqual(emittedSequences, []);
      processInput("\x07");
      assert.deepStrictEqual(emittedSequences, [replies[0]?.reply]);
    });

    it("still times out bare string introducers as Alt keys", (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      for (const prefix of ["\x1b]", "\x1bP", "\x1b_"]) {
        processInput(prefix);
        t.mock.timers.tick(10);
      }
      assert.deepStrictEqual(emittedSequences, ["\x1b]", "\x1bP", "\x1b_"]);
    });
  });
});

describe("StdinBuffer", () => {
  describe("Terminal Reply Strings", () => {
    terminalReplyStringsCases1();
  });
});

function terminalReplyStringsCases1(): void {
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
  for (const ambiguous of [
    "\x1b]a",
    "\x1b]1",
    "\x1b]10",
    "\x1b]0;title",
    "\x1b]4;",
    "\x1b]4;a;",
    "\x1bPa",
    "\x1bP>",
    "\x1b_a",
    "\x1b_G",
    "\x1b_Gi=1",
  ]) {
    it(`recovers batched legacy Alt input ${JSON.stringify(ambiguous)} within the sequence timeout`, (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const legacyBuffer = new StdinBuffer();
      const sequences: string[] = [];
      legacyBuffer.on("data", (sequence) => sequences.push(sequence));
      try {
        legacyBuffer.process(ambiguous);
        t.mock.timers.tick(20);
        legacyBuffer.process("x\r\x03\x04");
        t.mock.timers.tick(49);
        assert.deepStrictEqual(sequences, []);
        t.mock.timers.tick(1);
        assert.deepStrictEqual(sequences, [
          ambiguous.slice(0, 2),
          ...ambiguous.slice(2),
          "x",
          "\r",
          "\x03",
          "\x04",
        ]);
        assert.strictEqual(legacyBuffer.getBuffer(), "");

        legacyBuffer.process("y\r\x03\x04");
        assert.deepStrictEqual(sequences.slice(-4), ["y", "\r", "\x03", "\x04"]);
      } finally {
        legacyBuffer.destroy();
      }
    });
  }
}

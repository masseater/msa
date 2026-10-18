import assert from "node:assert";
import { describe, it } from "node:test";

import { findWordBackward, findWordForward } from "../src/word-navigation.ts";

const marker = "[paste #1 +5 lines]";

const text = `hello ${marker} world`;

const isAtomic = (s: string) => s === marker;

const segmentMap = new Map<string, Intl.SegmentData[]>([
  [
    text,
    [
      { segment: "hello", index: 0, input: text, isWordLike: true },
      { segment: " ", index: 5, input: text, isWordLike: false },
      { segment: marker, index: 6, input: text, isWordLike: true },
      { segment: " ", index: 25, input: text, isWordLike: false },
      { segment: "world", index: 26, input: text, isWordLike: true },
    ],
  ],
  [
    text.slice(0, text.length),
    [
      { segment: "hello", index: 0, input: text, isWordLike: true },
      { segment: " ", index: 5, input: text, isWordLike: false },
      { segment: marker, index: 6, input: text, isWordLike: true },
      { segment: " ", index: 25, input: text, isWordLike: false },
      { segment: "world", index: 26, input: text, isWordLike: true },
    ],
  ],
  [
    text.slice(0, 26),
    [
      { segment: "hello", index: 0, input: text, isWordLike: true },
      { segment: " ", index: 5, input: text, isWordLike: false },
      { segment: marker, index: 6, input: text, isWordLike: true },
      { segment: " ", index: 25, input: text, isWordLike: false },
    ],
  ],
  [
    text.slice(6),
    [
      { segment: marker, index: 0, input: text, isWordLike: true },
      { segment: " ", index: 19, input: text, isWordLike: false },
      { segment: "world", index: 20, input: text, isWordLike: true },
    ],
  ],
]);

const opts = {
  segment: (input: string) => segmentMap.get(input) ?? [],
  isAtomicSegment: isAtomic,
};

describe("findWordBackward", () => {
  it("basic words: hello world", () => {
    const input = "hello world";
    assert.strictEqual(findWordBackward(input, 11), 6);
    assert.strictEqual(findWordBackward(input, 6), 0);
  });

  it("dotted: foo.bar", () => {
    const input = "foo.bar";
    assert.strictEqual(findWordBackward(input, 7), 4);
    assert.strictEqual(findWordBackward(input, 4), 3);
    assert.strictEqual(findWordBackward(input, 3), 0);
  });

  it("colon: foo:bar", () => {
    const input = "foo:bar";
    assert.strictEqual(findWordBackward(input, 7), 4);
    assert.strictEqual(findWordBackward(input, 4), 3);
    assert.strictEqual(findWordBackward(input, 3), 0);
  });

  it("path: path/to/file", () => {
    const input = "path/to/file";
    assert.strictEqual(findWordBackward(input, 12), 8);
    assert.strictEqual(findWordBackward(input, 8), 7);
    assert.strictEqual(findWordBackward(input, 7), 5);
    assert.strictEqual(findWordBackward(input, 5), 4);
    assert.strictEqual(findWordBackward(input, 4), 0);
  });

  it("CJK mixed", () => {
    const input = "你好世界 test";
    assert.strictEqual(findWordBackward(input, input.length), 5);
    assert.strictEqual(findWordBackward(input, 5), 2);
    assert.strictEqual(findWordBackward(input, 2), 0);
  });

  it("whitespace at boundaries", () => {
    const input = "  hello  ";
    assert.strictEqual(findWordBackward(input, 9), 2);
    assert.strictEqual(findWordBackward(input, 2), 0);
  });
});

describe("findWordBackward", () => {
  it("punctuation run: foo...bar", () => {
    const input = "foo...bar";
    assert.strictEqual(findWordBackward(input, 9), 6);
    assert.strictEqual(findWordBackward(input, 6), 3);
    assert.strictEqual(findWordBackward(input, 3), 0);
  });

  it("cursor at 0 returns 0", () => {
    assert.strictEqual(findWordBackward("hello", 0), 0);
  });
});

describe("findWordForward", () => {
  it("basic words: hello world", () => {
    const input = "hello world";
    assert.strictEqual(findWordForward(input, 0), 5);
    assert.strictEqual(findWordForward(input, 5), 11);
  });

  it("dotted: foo.bar", () => {
    const input = "foo.bar";
    assert.strictEqual(findWordForward(input, 0), 3);
    assert.strictEqual(findWordForward(input, 3), 4);
    assert.strictEqual(findWordForward(input, 4), 7);
  });

  it("colon: foo:bar", () => {
    const input = "foo:bar";
    assert.strictEqual(findWordForward(input, 0), 3);
    assert.strictEqual(findWordForward(input, 3), 4);
    assert.strictEqual(findWordForward(input, 4), 7);
  });

  it("path: path/to/file", () => {
    const input = "path/to/file";
    assert.strictEqual(findWordForward(input, 0), 4);
    assert.strictEqual(findWordForward(input, 4), 5);
    assert.strictEqual(findWordForward(input, 5), 7);
    assert.strictEqual(findWordForward(input, 7), 8);
    assert.strictEqual(findWordForward(input, 8), 12);
  });

  it("CJK mixed", () => {
    const input = "你好世界 test";
    const firstEnd = findWordForward(input, 0);
    assert.ok(firstEnd > 0);
    assert.ok(firstEnd <= 4);
    let pos = 0;
    while (pos < input.length) {
      const next = findWordForward(input, pos);
      if (next === pos) break;
      pos = next;
    }
    assert.strictEqual(pos, input.length);
  });
});

describe("findWordForward", () => {
  it("whitespace at boundaries", () => {
    const input = "  hello  ";
    assert.strictEqual(findWordForward(input, 0), 7);
    assert.strictEqual(findWordForward(input, 7), 9);
  });

  it("punctuation run: foo...bar", () => {
    const input = "foo...bar";
    assert.strictEqual(findWordForward(input, 0), 3);
    assert.strictEqual(findWordForward(input, 3), 6);
    assert.strictEqual(findWordForward(input, 6), 9);
  });

  it("cursor at end returns end", () => {
    assert.strictEqual(findWordForward("hello", 5), 5);
  });
});

describe("atomic segments", () => {
  it("backward skips word then stops before atomic marker", () => {
    assert.strictEqual(findWordBackward(text, text.length, opts), 26);
  });

  it("backward skips whitespace then atomic marker as one unit", () => {
    assert.strictEqual(findWordBackward(text, 26, opts), 6);
  });

  it("forward skips atomic marker as one unit", () => {
    assert.strictEqual(findWordForward(text, 6, opts), 6 + marker.length);
  });
});

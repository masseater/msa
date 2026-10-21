import { describe, expect, it } from "vite-plus/test";

import outputModule from "../src/output.ts";
import output from "./fixtures/output.ts";

const { OutputBuffer, boundOutput, sanitizeOutput } = outputModule;

const { assertMatchesBufferTail, bound, head, sampledByteLimits, tail } = output;

const removesControlCharactersButKeepsTabs = (): void => {
  expect(sanitizeOutput("a\0b\tc\nd\re\u0007f\ufff9g\ufffbh😀")).toBe("ab\tc\ndefgh😀");
};

const keepsOutputWithinTheLimitsUnchanged = (): void => {
  expect(bound("a\nb\n", head(2, 1000))).toEqual({
    droppedBytes: 0,
    droppedLines: 0,
    kept: "a\nb\n",
  });
  expect(bound("a\nb", tail(2, 1000))).toEqual({ droppedBytes: 0, droppedLines: 0, kept: "a\nb" });
  expect(bound("", tail(2, 1000))).toEqual({ droppedBytes: 0, droppedLines: 0, kept: "" });
};

const keepsNothingWithAZeroLimit = (): void => {
  expect(bound("ab\ncd\n", head(10, 0))).toEqual({ droppedBytes: 6, droppedLines: 2, kept: "" });
  expect(bound("ab\ncd\n", tail(0, 1000))).toEqual({ droppedBytes: 6, droppedLines: 2, kept: "" });
};

const keepsExactSlicesOfWholeLines = (): void => {
  expect(bound("a\nb\nc\n", head(2, 1000))).toEqual({
    droppedBytes: 2,
    droppedLines: 1,
    kept: "a\nb\n",
  });
  expect(bound("a\nb\nc\n", tail(2, 1000))).toEqual({
    droppedBytes: 2,
    droppedLines: 1,
    kept: "b\nc\n",
  });
  expect(bound("a\nb\nc", tail(2, 1000))).toEqual({
    droppedBytes: 2,
    droppedLines: 1,
    kept: "b\nc",
  });
  expect(bound("a\nb\nc\n\n", tail(3, 1000))).toEqual({
    droppedBytes: 2,
    droppedLines: 1,
    kept: "b\nc\n\n",
  });
};

const cutsAtTheByteLimitOn = (): void => {
  expect(bound("aa\nbb\ncc\n", head(10, 7))).toEqual({
    droppedBytes: 3,
    droppedLines: 1,
    kept: "aa\nbb\n",
  });
  expect(bound("aa\nbb\ncc\n", tail(10, 7))).toEqual({
    droppedBytes: 3,
    droppedLines: 1,
    kept: "bb\ncc\n",
  });
};

const cutsASingleLineLongerThan = (): void => {
  expect(bound("ééé\n", head(10, 5))).toEqual({ droppedBytes: 3, droppedLines: 0, kept: "éé" });
  expect(bound("x\néééé", tail(10, 5))).toEqual({ droppedBytes: 6, droppedLines: 1, kept: "éé" });
};

const keepsAUFeffAtThe = (): void => {
  expect(bound("x\ufeffa", tail(10, 4))).toEqual({
    droppedBytes: 1,
    droppedLines: 0,
    kept: "\ufeffa",
  });
};

const cutsTailsOfSurrogateEdgeCases = (): void => {
  const inputs = [
    "a\ud83d",
    "\ude42b",
    "a\ude42b",
    "\ud83d\ud83d\ude42",
    "\ud83d\ude42\ude42",
    "👩‍💻",
  ];
  for (const input of inputs) assertMatchesBufferTail(input);
};

const cutsTailsExactlyLikeBufferAcross = (): void => {
  const alphabet = [
    "a",
    "\u007f",
    "\u0080",
    "é",
    "\u07ff",
    "\u0800",
    "中",
    "\ud7ff",
    "\ud800",
    "\ud83d",
    "\udc00",
    "\ude42",
    "🙂",
    "\ue000",
    "\uffff",
  ];
  function checkExhaustive(prefix: string, depth: number): void {
    assertMatchesBufferTail(prefix, sampledByteLimits(prefix));
    if (depth === 0) return;
    for (const character of alphabet) checkExhaustive(prefix + character, depth - 1);
  }
  checkExhaustive("", 3);
  let seed = 0x12345678;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = 0; i < 1_000; i++) {
    let input = "";
    const length = Math.floor(random() * 80);
    for (let j = 0; j < length; j++) input += alphabet[Math.floor(random() * alphabet.length)];
    assertMatchesBufferTail(input, sampledByteLimits(input));
  }
};

describe("tool output bounds", () => {
  it(
    "removes control characters but keeps tabs, newlines, and other text",
    removesControlCharactersButKeepsTabs,
  );

  it("keeps output within the limits unchanged", keepsOutputWithinTheLimitsUnchanged);

  it("keeps nothing with a zero limit", keepsNothingWithAZeroLimit);

  it("keeps exact slices of whole lines, trailing newline included", keepsExactSlicesOfWholeLines);

  it("cuts at the byte limit on whole lines when possible", cutsAtTheByteLimitOn);

  it(
    "cuts a single line longer than the byte limit on a character boundary",
    cutsASingleLineLongerThan,
  );

  it("keeps a U+FEFF at the start of a kept slice", keepsAUFeffAtThe);

  it("cuts tails of surrogate edge cases exactly like Buffer", cutsTailsOfSurrogateEdgeCases);

  it(
    "cuts tails exactly like Buffer across deterministic fuzz cases",
    cutsTailsExactlyLikeBufferAcross,
  );
});

const keepsExactTotalsAcrossChunksAnd = (): void => {
  const buffer = new OutputBuffer(tail(2, 1000));
  const bytes = new TextEncoder().encode("😀\n");
  buffer.push("a\nb\n");
  buffer.push(bytes.subarray(0, 2));
  buffer.push(bytes.subarray(2));
  expect(buffer.snapshot()).toEqual({ droppedBytes: 2, droppedLines: 1, text: "b\n😀\n" });
};

const sanitizesTheRetainedTextButCounts = (): void => {
  const buffer = new OutputBuffer(tail(1, 1000));
  buffer.push("a\u0007\n");
  expect(buffer.snapshot()).toEqual({ droppedBytes: 0, droppedLines: 0, text: "a\n" });
  buffer.push("b\u001b\n");
  expect(buffer.snapshot()).toEqual({ droppedBytes: 3, droppedLines: 1, text: "b\n" });
};

const dropsAByteOrderMarkOnly = (): void => {
  const bom = Uint8Array.of(0xef, 0xbb, 0xbf);
  const buffer = new OutputBuffer(tail(10, 1000));
  buffer.push(bom.subarray(0, 1));
  buffer.push(Uint8Array.of(0xbb, 0xbf, 0x61));
  buffer.push("b");
  buffer.push(Uint8Array.of(...bom, 0x63));
  buffer.end();
  expect(buffer.snapshot().text).toBe("ab\ufeffc");
};

const flushesAnIncompleteCharacterBeforeA = (): void => {
  const buffer = new OutputBuffer(tail(10, 1000));
  const euro = new TextEncoder().encode("€");
  buffer.push(euro.subarray(0, 1));
  buffer.push("x");
  buffer.push(euro.subarray(0, 2));
  buffer.end();
  expect(buffer.snapshot().text).toBe("\ufffdx\ufffd");
};

const matchesBoundingTheWholeStreamWhen = (): void => {
  for (const limits of [head(3, 40), tail(3, 40), head(50, 25), tail(50, 25)]) {
    const buffer = new OutputBuffer(limits);
    let stream = "";
    for (let index = 0; index < 300; index++) {
      const chunk = index % 7 === 0 ? `${"é".repeat(index % 30)}\n` : `line ${index}\n`;
      stream += chunk;
      buffer.push(chunk);
      if (index % 5 !== 4) continue;
      const expected = boundOutput(stream, limits);
      expect(buffer.snapshot()).toEqual({
        droppedBytes: expected.droppedBytes,
        droppedLines: expected.droppedLines,
        text: expected.text,
      });
    }
  }
};

const stopsStoringHeadOutputOnceThe = (): void => {
  const buffer = new OutputBuffer(head(2, 1000));
  for (let index = 0; index < 1000; index++) buffer.push(`line ${index}\n`);
  expect(buffer.storedBytes).toBeLessThan(20);
  expect(buffer.snapshot()).toEqual({
    droppedBytes: 8876,
    droppedLines: 998,
    text: "line 0\nline 1\n",
  });
};

const storesOnlyTheTailWindowAfter = (): void => {
  const buffer = new OutputBuffer(tail(3, 100));
  let stream = "";
  for (let index = 0; index < 2000; index++) {
    const chunk = `line ${index}\n\n`;
    stream += chunk;
    buffer.push(chunk);
    const snapshot = buffer.snapshot();
    expect(buffer.storedBytes).toBeLessThanOrEqual(100);
    expect(snapshot.text).toBe(boundOutput(stream, tail(3, 100)).text);
  }
};

describe("OutputBuffer", () => {
  it(
    "keeps exact totals across chunks and decodes UTF-8 split across byte chunks",
    keepsExactTotalsAcrossChunksAnd,
  );

  it("sanitizes the retained text but counts the raw stream", sanitizesTheRetainedTextButCounts);

  it("drops a byte-order mark only at the start of the output", dropsAByteOrderMarkOnly);

  it(
    "flushes an incomplete character before a string chunk and at the end",
    flushesAnIncompleteCharacterBeforeA,
  );

  it(
    "matches bounding the whole stream when several chunks arrive between snapshots",
    matchesBoundingTheWholeStreamWhen,
  );

  it("stops storing head output once the window is full", stopsStoringHeadOutputOnceThe);

  it("stores only the tail window after each snapshot", storesOnlyTheTailWindowAfter);
});

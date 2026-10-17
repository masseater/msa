import { describe, expect, it } from "vite-plus/test";

import { OutputBuffer, type OutputLimits, type OutputSkip } from "../src/output.ts";

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = [
  "a",
  "b",
  "z",
  " ",
  "\n",
  "\n",
  "\n",
  "\r\n",
  "\t",
  "é",
  "€",
  "😀",
  "\ufffd",
  "\x01",
  "\x1b",
];

function randomChunk(next: () => number): string {
  const length = Math.floor(next() * 12);
  let text = "";
  for (let index = 0; index < length; index++)
    text += ALPHABET[Math.floor(next() * ALPHABET.length)];
  return text;
}

function measure(text: string): OutputSkip {
  let newlines = 0;
  for (const character of text) if (character === "\n") newlines++;
  return { bytes: Buffer.byteLength(text, "utf8"), newlines, endsWithNewline: text.endsWith("\n") };
}

function exceedsWindow(text: string, limits: OutputLimits): boolean {
  const { bytes, newlines } = measure(text);
  return bytes > limits.maxBytes || newlines > limits.maxLines;
}

function boundaries(text: string): number[] {
  const result = [0];
  let offset = 0;
  for (const character of text) {
    offset += character.length;
    result.push(offset);
  }
  return result;
}

function checkSeed(seed: number): void {
  const next = random(seed);
  const limits: OutputLimits = {
    maxBytes: 1 + Math.floor(next() * 40),
    maxLines: 1 + Math.floor(next() * 5),
    retain: "tail",
  };
  const full = new OutputBuffer(limits);
  const skipping = new OutputBuffer(limits);
  let pending = "";
  let skips = 0;
  const flush = (): void => {
    if (pending === "") return;
    const cuts = boundaries(pending).filter(
      (cut) => cut > 0 && exceedsWindow(pending.slice(cut), limits),
    );
    if (cuts.length > 0 && next() < 0.7) {
      const cut = cuts[Math.floor(next() * cuts.length)]!;
      skipping.push(pending.slice(cut), measure(pending.slice(0, cut)));
      skips++;
    } else {
      skipping.push(pending);
    }
    pending = "";
    if (next() < 0.5) skipping.snapshot();
    expect(skipping.snapshot(), `seed ${seed}`).toEqual(full.snapshot());
  };
  const chunks = Math.floor(next() * 40);
  for (let index = 0; index < chunks; index++) {
    const chunk = randomChunk(next);
    full.push(chunk);
    if (next() < 0.3) full.snapshot();
    pending += chunk;
    if (next() < 0.3) flush();
  }
  flush();
  full.end();
  skipping.end();
  expect(skipping.snapshot(), `seed ${seed}`).toEqual(full.snapshot());
  expect(skips >= 0).toBe(true);
}

const keepsTheSameTailWheneverProgress = (): void => {
  for (let seed = 1; seed <= 3000; seed++) {
    const next = random(seed);
    const limits: OutputLimits = {
      maxBytes: 1 + Math.floor(next() * 40),
      maxLines: 1 + Math.floor(next() * 5),
      retain: "tail",
    };
    const plain = new OutputBuffer(limits);
    const sampled = new OutputBuffer(limits);
    const chunks = Math.floor(next() * 30);
    for (let index = 0; index < chunks; index++) {
      const chunk = randomChunk(next);
      plain.push(chunk);
      sampled.push(chunk);
      if (next() < 0.4) sampled.snapshot();
    }
    expect(sampled.snapshot(), `seed ${seed}`).toEqual(plain.snapshot());
  }
};

const matchesTheFullStreamForEvery = (): void => {
  for (let seed = 1; seed <= 3000; seed++) checkSeed(seed);
};

const countsSkippedBytesLinesAndThe = (): void => {
  const limits: OutputLimits = { maxBytes: 1000, maxLines: 2, retain: "tail" };
  const full = new OutputBuffer(limits);
  const skipping = new OutputBuffer(limits);
  const omitted = "one\ntwo\nthr";
  const kept = "ee\nfour\nfive\nsix";
  full.push(omitted + kept);
  skipping.push(kept, measure(omitted));
  expect(skipping.snapshot()).toEqual(full.snapshot());
  expect(skipping.snapshot()).toEqual({ text: "five\nsix", droppedBytes: 19, droppedLines: 4 });
};

const refusesSkipsForHeadRetention = (): void => {
  const buffer = new OutputBuffer({ maxBytes: 10, maxLines: 2, retain: "head" });
  expect(() => buffer.push("x\ny\nz\n", { bytes: 3, newlines: 1, endsWithNewline: true })).toThrow(
    "tail retention",
  );
};

describe("OutputBuffer skipped output", () => {
  it("keeps the same tail whenever progress snapshots happen", keepsTheSameTailWheneverProgress);

  it("matches the full stream for every legal skip pattern", matchesTheFullStreamForEvery);

  it("counts skipped bytes, lines and the final newline exactly", countsSkippedBytesLinesAndThe);

  it("refuses skips for head retention", refusesSkipsForHeadRetention);
});

import { dual } from "effect/Function";

import { boundOutput, type OutputLimits } from "../../src/output.ts";

const headImpl = (maxLines: number, maxBytes: number): OutputLimits => ({
  maxBytes,
  maxLines,
  retain: "head",
});

const tailImpl = (maxLines: number, maxBytes: number): OutputLimits => ({
  maxBytes,
  maxLines,
  retain: "tail",
});

function bufferTailImpl(content: string, maxBytes: number): string {
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length <= maxBytes) return content;
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString("utf8");
}

function assertMatchesBufferTailImpl(input: string, maxByteValues?: readonly number[]): void {
  const totalBytes = Buffer.byteLength(input, "utf8");
  const values = maxByteValues ?? Array.from({ length: totalBytes + 5 }, (_, maxBytes) => maxBytes);
  for (const maxBytes of values) {
    const kept = boundOutput(input, { maxBytes, maxLines: 10, retain: "tail" }).text;
    const expected = bufferTailImpl(input, maxBytes);
    if (kept !== expected) {
      throw new Error(
        `tail mismatch input=${JSON.stringify(input)} maxBytes=${maxBytes} expected=${JSON.stringify(expected)} actual=${JSON.stringify(kept)}`,
      );
    }
    if (Buffer.byteLength(kept, "utf8") > maxBytes)
      throw new Error(`tail output exceeded ${maxBytes} bytes`);
  }
}

export function sampledByteLimits(input: string): number[] {
  const totalBytes = Buffer.byteLength(input, "utf8");
  const candidates = [
    0,
    1,
    2,
    3,
    4,
    5,
    8,
    Math.floor(totalBytes / 2),
    totalBytes - 4,
    totalBytes - 1,
    totalBytes,
    totalBytes + 1,
  ];
  return [...new Set(candidates.filter((value) => value >= 0))].sort((a, b) => a - b);
}

function boundImpl(text: string, limits: OutputLimits) {
  const { text: kept, droppedBytes, droppedLines } = boundOutput(text, limits);
  return { kept, droppedBytes, droppedLines };
}

export const head: {
  (maxBytes: number): (maxLines: number) => OutputLimits;
  (maxLines: number, maxBytes: number): OutputLimits;
} = dual(2, headImpl);

export const tail: {
  (maxBytes: number): (maxLines: number) => OutputLimits;
  (maxLines: number, maxBytes: number): OutputLimits;
} = dual(2, tailImpl);

export const bufferTail: {
  (maxBytes: number): (content: string) => string;
  (content: string, maxBytes: number): string;
} = dual(2, bufferTailImpl);

export const assertMatchesBufferTail: {
  (maxByteValues?: readonly number[]): (input: string) => void;
  (input: string, maxByteValues?: readonly number[]): void;
} = dual((args: IArguments) => typeof args[0] === "string", assertMatchesBufferTailImpl);

type Bounded = ReturnType<typeof boundImpl>;

export const bound: {
  (limits: OutputLimits): (text: string) => Bounded;
  (text: string, limits: OutputLimits): Bounded;
} = dual(2, boundImpl);

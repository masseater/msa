import { boundOutput, type OutputLimits } from "../../src/output.ts";

export const head = (maxLines: number, maxBytes = 1000): OutputLimits => ({
  maxBytes,
  maxLines,
  retain: "head",
});

export const tail = (maxLines: number, maxBytes = 1000): OutputLimits => ({
  maxBytes,
  maxLines,
  retain: "tail",
});

export function bufferTail(content: string, maxBytes: number): string {
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length <= maxBytes) return content;
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString("utf8");
}

export function assertMatchesBufferTail(input: string, maxByteValues?: readonly number[]): void {
  const totalBytes = Buffer.byteLength(input, "utf8");
  const values = maxByteValues ?? Array.from({ length: totalBytes + 5 }, (_, maxBytes) => maxBytes);
  for (const maxBytes of values) {
    const kept = boundOutput(input, { maxBytes, maxLines: 10, retain: "tail" }).text;
    const expected = bufferTail(input, maxBytes);
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

export function bound(text: string, limits: OutputLimits) {
  const { text: kept, droppedBytes, droppedLines } = boundOutput(text, limits);
  return { kept, droppedBytes, droppedLines };
}

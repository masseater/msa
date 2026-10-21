import { Effect } from "effect";
import { dual } from "effect/Function";

import type readRangeTypes from "./read-range.types.ts";

const READ_DEPTH = 8;

const concat: {
  (total: number): (chunks: readonly Uint8Array[]) => Uint8Array;
  (chunks: readonly Uint8Array[], total: number): Uint8Array;
} = dual(2, (chunks: readonly Uint8Array[], total: number): Uint8Array => {
  if (chunks.length === 1) return chunks[0]!;
  const bytes = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.length;
  }
  return bytes;
});

type InFlight = { length: number; bytes: Promise<Uint8Array> };

const readRange = ({
  read,
  offset,
  length,
  chunk,
  aborted,
}: readRangeTypes.RangeRead): Effect.Effect<{ chunks: Uint8Array[]; total: number } | undefined> =>
  Effect.gen(function* () {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let next = offset;
    const inFlight: InFlight[] = [];
    while (total < length) {
      while (inFlight.length < READ_DEPTH && next < offset + length) {
        const size = Math.min(offset + length - next, chunk);
        const bytes = read(next, size);
        bytes.catch(() => undefined);
        inFlight.push({ bytes, length: size });
        next += size;
      }
      const head = inFlight.shift()!;
      const bytes = yield* Effect.promise(() => head.bytes);
      if (aborted()) return undefined;
      if (bytes.length === 0) break;
      chunks.push(bytes);
      total += bytes.length;
      if (bytes.length < head.length) {
        inFlight.length = 0;
        next = offset + total;
      }
    }
    return { chunks, total };
  });

const readRangeModule = {
  READ_DEPTH,
  concat,
  readRange,
};

export default readRangeModule;

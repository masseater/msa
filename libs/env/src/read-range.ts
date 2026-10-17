import { Effect } from "effect";
import { dual } from "effect/Function";

export const READ_DEPTH = 8;

export const concat: {
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

export interface RangeRead {
  readonly read: (offset: number, length: number) => Promise<Uint8Array>;
  readonly offset: number;
  readonly length: number;
  readonly chunk: number;
  readonly aborted: () => boolean;
}

type InFlight = { length: number; bytes: Promise<Uint8Array> };

export const readRange = ({
  read,
  offset,
  length,
  chunk,
  aborted,
}: RangeRead): Effect.Effect<{ chunks: Uint8Array[]; total: number } | undefined> =>
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
        inFlight.push({ length: size, bytes });
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

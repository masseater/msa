import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import type { Dual2 } from "../dual.ts";
import { type BinaryReader, type FileInfo, getOrThrow, type LineScan } from "../env/index.ts";

export type BinarySource = {
  readonly info: Effect.Effect<FileInfo>;
  read(position: number, length: number): Effect.Effect<Uint8Array>;
  scanLines(options: { startLine: number; endLine?: number }): Effect.Effect<LineScan>;
  readonly close: Effect.Effect<void>;
};

export const binarySource: Dual2<BinaryReader, Context, BinarySource> = Function.dual(
  2,
  (reader: BinaryReader, context: Context): BinarySource => ({
    info: Effect.map(
      Effect.promise(() => reader.info(context)),
      getOrThrow,
    ),
    read: (position, length) =>
      Effect.map(
        Effect.promise(() => reader.read(position, length, context)),
        getOrThrow,
      ),
    scanLines: (options) =>
      Effect.map(
        Effect.promise(() => reader.scanLines(options, context)),
        getOrThrow,
      ),
    close: Effect.promise(() => reader.close(context)),
  }),
);

import { type WriteStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";

import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import { awaited, awaiting } from "../core/awaiting.ts";
import { join } from "../core/platform-node.ts";
import { writeFile } from "./node-fs.ts";
import { randomHex } from "./platform-extra.ts";

const OUTPUT_FILE_MODE = 0o600;

function createOutputFilePath(prefix: string, extension: string): string {
  return join(tmpdir(), `${prefix}-${randomHex(8)}${extension}`);
}

function writeOutputFileImpl(
  prefix: string,
  extension: string,
  data: string | Uint8Array,
): Promise<string> {
  return Effect.runPromise(
    awaiting(function* () {
      const path = createOutputFilePath(prefix, extension);

      yield* awaited(writeFile({ data, flag: "wx", mode: OUTPUT_FILE_MODE, path }));
      return path;
    }),
  );
}

export const writeOutputFile: {
  (prefix: string, extension: string, data: string | Uint8Array): Promise<string>;
  (extension: string, data: string | Uint8Array): (prefix: string) => Promise<string>;
} = dual((args: IArguments) => args.length >= 3, writeOutputFileImpl);

export interface OutputFileStream {
  readonly path: string;
  readonly stream: WriteStream;
}

function createOutputFileStreamImpl(prefix: string, extension: string): OutputFileStream {
  const path = createOutputFilePath(prefix, extension);
  return { path, stream: createWriteStream(path, { flags: "wx", mode: OUTPUT_FILE_MODE }) };
}

export const createOutputFileStream: {
  (prefix: string, extension: string): OutputFileStream;
  (extension: string): (prefix: string) => OutputFileStream;
} = dual((args: IArguments) => args.length >= 2, createOutputFileStreamImpl);

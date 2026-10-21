import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../core/awaiting.ts";
import platformModule from "../core/platform/index.ts";
import platformNodeFs from "../core/platform/node/fs.ts";
import nodeOs from "../core/platform/node/os.ts";
import type outputFilesTypes from "./output-files.types.ts";

const { tmpdir } = nodeOs;

const { createWriteStream } = platformNodeFs;

const { join, randomHex } = platformModule;
const { awaited, awaiting } = awaitingModule;
const { writeFile } = platformModule.files;

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

const writeOutputFile: {
  (prefix: string, extension: string, data: string | Uint8Array): Promise<string>;
  (extension: string, data: string | Uint8Array): (prefix: string) => Promise<string>;
} = dual((args: IArguments) => args.length >= 3, writeOutputFileImpl);

function createOutputFileStreamImpl(
  prefix: string,
  extension: string,
): outputFilesTypes.OutputFileStream {
  const path = createOutputFilePath(prefix, extension);
  return { path, stream: createWriteStream(path, { flags: "wx", mode: OUTPUT_FILE_MODE }) };
}

const createOutputFileStream: {
  (prefix: string, extension: string): outputFilesTypes.OutputFileStream;
  (extension: string): (prefix: string) => outputFilesTypes.OutputFileStream;
} = dual((args: IArguments) => args.length >= 2, createOutputFileStreamImpl);

const outputFiles = {
  createOutputFileStream,
  writeOutputFile,
};

export default outputFiles;

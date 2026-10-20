import {
  type BinaryReader,
  type DirReader,
  type FileError,
  type Result,
  type TextLineReader,
  ok,
} from "@msa/durable/env";
import { Effect } from "effect";

import binaryReader from "./binary-reader.ts";
import dirReader from "./dir-reader.ts";
import fileOp from "./file-op.ts";
import type fileOpTypes from "./file-op.types.ts";
import readFile from "./read-file.ts";
import type readOpsTypes from "./read-ops.types.ts";
import textLineReader from "./text-line-reader.ts";

const { openDir, openFile, openReader, run, runFileOp } = fileOp;
const { readOpenedFile } = readFile;
const { RemoteBinaryReader } = binaryReader;
const { RemoteTextLineReader } = textLineReader;
const { RemoteDirReader } = dirReader;

const readFileAt = (
  request: readOpsTypes.FileReadRequest,
): Promise<Result<Uint8Array | string, FileError>> => {
  const { connection } = request.target;
  return run(
    runFileOp({
      ...request,
      operation: (resolved) =>
        openFile({ connection, json: { mode: "read" }, resolved }).pipe(
          Effect.flatMap(({ handle, json }) =>
            readOpenedFile({
              encoding: request.encoding,
              handle,
              opened: json,
              signal: request.context.abortSignal,
            }),
          ),
        ),
    }),
  );
};

const openBinaryReaderAt = (
  request: readOpsTypes.BinaryReaderRequest,
): Promise<Result<BinaryReader, FileError>> => {
  const { connection } = request.target;
  return openReader<BinaryReader>({
    ...request,
    open: (resolved) =>
      openFile({ connection, json: { noFollow: request.noFollow }, resolved }).pipe(
        Effect.map(({ handle }) => handle),
      ),
    wrap: (handle) => new RemoteBinaryReader(handle),
  });
};

const openTextLineReaderAt = (
  request: fileOpTypes.PathRequest,
): Promise<Result<TextLineReader, FileError>> => {
  const { connection } = request.target;
  return openReader<TextLineReader>({
    ...request,
    open: (resolved) =>
      openFile({ connection, json: { mode: "read" }, resolved }).pipe(
        Effect.map(({ handle }) => handle),
      ),
    wrap: (handle) => new RemoteTextLineReader(handle),
  });
};

const openDirReaderAt = (
  request: fileOpTypes.PathRequest,
): Promise<Result<DirReader, FileError>> => {
  const { connection } = request.target;
  return openReader<DirReader>({
    ...request,
    open: (resolved) => openDir({ connection, resolved }),
    wrap: (handle) => new RemoteDirReader(handle),
  });
};

const readLines = (
  reader: TextLineReader,
  request: readOpsTypes.TextLinesRequest,
): Effect.Effect<Result<string[], FileError>> =>
  Effect.gen(function* () {
    const max = request.maxLines ?? Number.POSITIVE_INFINITY;
    const lines: string[] = [];
    while (lines.length < max) {
      const line = yield* Effect.promise(() => reader.readLine(request.context));
      if (!line.ok) return line;
      if (line.value === undefined) break;
      lines.push(line.value.text);
    }
    return ok<string[], FileError>(lines);
  }).pipe(Effect.ensuring(Effect.promise(() => reader.close(request.context))));

const readTextLinesAt = (
  request: readOpsTypes.TextLinesRequest,
): Promise<Result<string[], FileError>> =>
  run(
    Effect.gen(function* () {
      const opened = yield* Effect.promise(() => openTextLineReaderAt(request));
      if (!opened.ok) return opened;
      return yield* readLines(opened.value, request);
    }),
  );

const readOps = {
  openBinaryReaderAt,
  openDirReaderAt,
  openTextLineReaderAt,
  readFileAt,
  readTextLinesAt,
};

export default readOps;

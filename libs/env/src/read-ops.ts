import {
  type BinaryReader,
  type DirReader,
  type FileError,
  ok,
  type Result,
  type TextLineReader,
} from "@msa/durable/env";
import { Effect } from "effect";

import { RemoteBinaryReader } from "./binary-reader.ts";
import { RemoteDirReader } from "./dir-reader.ts";
import { openDir, openFile, openReader, type PathRequest, run, runFileOp } from "./file-op.ts";
import { readOpenedFile } from "./read-file.ts";
import { RemoteTextLineReader } from "./text-line-reader.ts";

export interface FileReadRequest extends PathRequest {
  readonly encoding: boolean;
}

export interface BinaryReaderRequest extends PathRequest {
  readonly noFollow: boolean;
}

export interface TextLinesRequest extends PathRequest {
  readonly maxLines: number | undefined;
}

export const readFileAt = (
  request: FileReadRequest,
): Promise<Result<Uint8Array | string, FileError>> => {
  const { connection } = request.target;
  return run(
    runFileOp({
      ...request,
      operation: (resolved) =>
        openFile({ connection, resolved, json: { mode: "read" } }).pipe(
          Effect.flatMap(({ handle, json }) =>
            readOpenedFile({
              handle,
              opened: json,
              encoding: request.encoding,
              signal: request.context.abortSignal,
            }),
          ),
        ),
    }),
  );
};

export const openBinaryReaderAt = (
  request: BinaryReaderRequest,
): Promise<Result<BinaryReader, FileError>> => {
  const { connection } = request.target;
  return openReader<BinaryReader>({
    ...request,
    open: (resolved) =>
      openFile({ connection, resolved, json: { noFollow: request.noFollow } }).pipe(
        Effect.map(({ handle }) => handle),
      ),
    wrap: (handle) => new RemoteBinaryReader(handle),
  });
};

export const openTextLineReaderAt = (
  request: PathRequest,
): Promise<Result<TextLineReader, FileError>> => {
  const { connection } = request.target;
  return openReader<TextLineReader>({
    ...request,
    open: (resolved) =>
      openFile({ connection, resolved, json: { mode: "read" } }).pipe(
        Effect.map(({ handle }) => handle),
      ),
    wrap: (handle) => new RemoteTextLineReader(handle),
  });
};

export const openDirReaderAt = (request: PathRequest): Promise<Result<DirReader, FileError>> => {
  const { connection } = request.target;
  return openReader<DirReader>({
    ...request,
    open: (resolved) => openDir({ connection, resolved }),
    wrap: (handle) => new RemoteDirReader(handle),
  });
};

const readLines = (
  reader: TextLineReader,
  request: TextLinesRequest,
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

export const readTextLinesAt = (request: TextLinesRequest): Promise<Result<string[], FileError>> =>
  run(
    Effect.gen(function* () {
      const opened = yield* Effect.promise(() => openTextLineReaderAt(request));
      if (!opened.ok) return opened;
      return yield* readLines(opened.value, request);
    }),
  );

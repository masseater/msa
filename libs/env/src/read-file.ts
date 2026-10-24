import { StringDecoder } from "node:string_decoder";

import env from "@msa/durable/env";
import type envTypes from "@msa/durable/env.types";
import { Effect } from "effect";

import connection from "./connection.ts";
import type connectionTypes from "./connection.types.ts";
import type readFileTypes from "./read-file.types.ts";
import readRangeModule from "./read-range.ts";
import remotePathModule from "./remote-path.ts";

const { FileError } = env;

const { READ_DEPTH, readRange } = readRangeModule;
const { RemoteError } = connection;
const { remoteFileInfo } = remotePathModule;

const READ_FILE_CHUNK = 512 * 1024;
const READ_FILE_UNKNOWN_CHUNK = 64 * 1024;
const READ_FILE_MAX = 2 ** 31 - 1;

const abortedRead = (read: readFileTypes.FileRead): boolean => read.signal?.aborted === true;

const abortError = (read: readFileTypes.FileRead): envTypes.FileError =>
  FileError.create("aborted", "The operation was aborted", read.handle.path);

const readUnknownSize = (
  read: readFileTypes.FileRead,
): Effect.Effect<Uint8Array | string, envTypes.FileError> =>
  Effect.gen(function* () {
    const decoder = new StringDecoder("utf8");
    const chunks: Uint8Array[] = [];
    let total = 0;
    let text = "";
    for (;;) {
      if (abortedRead(read)) return yield* abortError(read);
      const bytes = yield* Effect.promise(() =>
        read.handle.pread(undefined, READ_FILE_UNKNOWN_CHUNK),
      );
      if (bytes.length === 0) break;
      total += bytes.length;
      chunks.push(bytes);
      if (read.encoding) text += decoder.write(bytes);
    }
    if (!read.encoding) return Buffer.concat(chunks, total);
    return total === 0 ? "" : text + decoder.end();
  });

const readBinary = (
  read: readFileTypes.FileRead,
  size: number,
): Effect.Effect<Uint8Array, envTypes.FileError> => {
  if (size <= READ_FILE_CHUNK) {
    return Effect.promise(() => read.handle.pread(0, size)).pipe(
      Effect.map((bytes) => Buffer.from(bytes)),
    );
  }
  return readRange({
    aborted: () => abortedRead(read),
    chunk: READ_FILE_CHUNK,
    length: size,
    offset: 0,
    read: (at, length) => read.handle.pread(at, length),
  }).pipe(
    Effect.flatMap((range) =>
      range === undefined
        ? Effect.fail(abortError(read))
        : Effect.succeed(Buffer.concat(range.chunks, range.total)),
    ),
  );
};

const readDecoded = (
  read: readFileTypes.FileRead,
  size: number,
): Effect.Effect<string, envTypes.FileError> =>
  Effect.gen(function* () {
    const length = Math.min(size, READ_FILE_CHUNK);
    const decoder = new StringDecoder("utf8");
    let text = "";
    let total = 0;
    let first = true;
    const inFlight: Promise<Uint8Array>[] = [];
    let next = 0;
    for (;;) {
      while (inFlight.length < READ_DEPTH) {
        const pending = read.handle.pread(next, length);
        pending.catch(() => undefined);
        inFlight.push(pending);
        next += length;
      }
      const head = inFlight.shift()!;
      const bytes = yield* Effect.promise(() => head);
      if (abortedRead(read)) return yield* abortError(read);
      total += bytes.length;
      if (bytes.length === 0 || total === size || bytes.length !== length) {
        return first ? Buffer.from(bytes).toString("utf8") : text + decoder.end(Buffer.from(bytes));
      }
      text += decoder.write(Buffer.from(bytes));
      first = false;
    }
  });

const readContents = (
  read: readFileTypes.FileRead,
): Effect.Effect<Uint8Array | string, envTypes.FileError> =>
  Effect.gen(function* () {
    const statError = read.opened["statError"];
    if (statError !== undefined)
      return yield* Effect.die(RemoteError.create(statError as connectionTypes.Json));
    if (abortedRead(read)) return yield* abortError(read);
    const stat = remoteFileInfo(read.opened["stat"] as connectionTypes.Json);
    const size = stat.kind === "file" ? stat.size : 0;
    if (size > READ_FILE_MAX) {
      return yield* FileError.create(
        "unknown",
        `File size (${size}) is greater than 2 GiB`,
        read.handle.path,
      );
    }
    if (size === 0) return yield* readUnknownSize(read);
    if (!read.encoding) return yield* readBinary(read, size);
    return yield* readDecoded(read, size);
  });

const readOpenedFile = (
  read: readFileTypes.FileRead,
): Effect.Effect<Uint8Array | string, envTypes.FileError> =>
  readContents(read).pipe(Effect.ensuring(Effect.promise(() => read.handle.close())));

const readFile = {
  readOpenedFile,
};

export default readFile;

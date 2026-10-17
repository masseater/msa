import { StringDecoder } from "node:string_decoder";

import { FileError } from "@msa/durable/env";
import { Effect } from "effect";

import { type Json, RemoteError } from "./connection.ts";
import type { Handle } from "./handle.ts";
import { READ_DEPTH, readRange } from "./read-range.ts";
import { remoteFileInfo } from "./remote-path.ts";

const READ_FILE_CHUNK = 512 * 1024;
const READ_FILE_UNKNOWN_CHUNK = 64 * 1024;
const READ_FILE_MAX = 2 ** 31 - 1;

export interface FileRead {
  readonly handle: Handle;
  readonly opened: Json;
  readonly encoding: boolean;
  readonly signal: AbortSignal | undefined;
}

const abortedRead = (read: FileRead): boolean => read.signal?.aborted === true;

const abortError = (read: FileRead): FileError =>
  new FileError("aborted", "The operation was aborted", read.handle.path);

const readUnknownSize = (read: FileRead): Effect.Effect<Uint8Array | string, FileError> =>
  Effect.gen(function* () {
    const decoder = new StringDecoder("utf8");
    const chunks: Uint8Array[] = [];
    let total = 0;
    let text = "";
    for (;;) {
      if (abortedRead(read)) return yield* Effect.fail(abortError(read));
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

const readBinary = (read: FileRead, size: number): Effect.Effect<Uint8Array, FileError> => {
  if (size <= READ_FILE_CHUNK) {
    return Effect.promise(() => read.handle.pread(0, size)).pipe(
      Effect.map((bytes) => Buffer.from(bytes)),
    );
  }
  return readRange({
    read: (at, length) => read.handle.pread(at, length),
    offset: 0,
    length: size,
    chunk: READ_FILE_CHUNK,
    aborted: () => abortedRead(read),
  }).pipe(
    Effect.flatMap((range) =>
      range === undefined
        ? Effect.fail(abortError(read))
        : Effect.succeed(Buffer.concat(range.chunks, range.total)),
    ),
  );
};

const readDecoded = (read: FileRead, size: number): Effect.Effect<string, FileError> =>
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
      if (abortedRead(read)) return yield* Effect.fail(abortError(read));
      total += bytes.length;
      if (bytes.length === 0 || total === size || bytes.length !== length) {
        return first ? Buffer.from(bytes).toString("utf8") : text + decoder.end(Buffer.from(bytes));
      }
      text += decoder.write(Buffer.from(bytes));
      first = false;
    }
  });

const readContents = (read: FileRead): Effect.Effect<Uint8Array | string, FileError> =>
  Effect.gen(function* () {
    const statError = read.opened["statError"];
    if (statError !== undefined) return yield* Effect.die(new RemoteError(statError as Json));
    if (abortedRead(read)) return yield* Effect.fail(abortError(read));
    const stat = remoteFileInfo(read.opened["stat"] as Json);
    const size = stat.kind === "file" ? stat.size : 0;
    if (size > READ_FILE_MAX) {
      return yield* Effect.fail(
        new FileError("unknown", `File size (${size}) is greater than 2 GiB`, read.handle.path),
      );
    }
    if (size === 0) return yield* readUnknownSize(read);
    if (!read.encoding) return yield* readBinary(read, size);
    return yield* readDecoded(read, size);
  });

export const readOpenedFile = (read: FileRead): Effect.Effect<Uint8Array | string, FileError> =>
  readContents(read).pipe(Effect.ensuring(Effect.promise(() => read.handle.close())));

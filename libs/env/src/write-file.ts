import { FileError } from "@msa/durable/env";
import { Effect } from "effect";

import type { Connection, Reply } from "./connection.ts";
import { Handle } from "./handle.ts";

const WRITE_CHUNK = 512 * 1024;
const WRITE_DEPTH = 8;

export interface FileWrite {
  readonly connection: Connection;
  readonly resolved: string;
  readonly bytes: Uint8Array;
  readonly append: boolean;
  readonly signal: AbortSignal | undefined;
}

const abortedWrite = (
  write: FileWrite,
  inFlight: readonly Promise<Reply>[],
): Effect.Effect<never, FileError> =>
  Effect.promise(() => Promise.allSettled(inFlight)).pipe(
    Effect.flatMap((settled) => {
      const failed = settled.find((result) => result.status === "rejected");
      return failed === undefined
        ? Effect.fail(new FileError("aborted", "The operation was aborted", write.resolved))
        : Effect.die(failed.reason);
    }),
  );

const writeChunks = (
  write: FileWrite,
  handle: Handle,
  inFlight: Promise<Reply>[],
): Effect.Effect<void, FileError> =>
  Effect.gen(function* () {
    const { bytes } = write;
    for (let offset = WRITE_CHUNK; offset < bytes.length; offset += WRITE_CHUNK) {
      if (write.signal?.aborted === true) return yield* abortedWrite(write, inFlight);
      const written = handle.request(
        "writeChunk",
        {},
        { payload: bytes.subarray(offset, offset + WRITE_CHUNK) },
      );
      written.catch(() => undefined);
      inFlight.push(written);
      if (inFlight.length >= WRITE_DEPTH) {
        const head = inFlight.shift()!;
        yield* Effect.promise(() => head);
      }
    }
    for (const written of inFlight) yield* Effect.promise(() => written);
  });

export const writeContent = (write: FileWrite): Effect.Effect<void, FileError> =>
  Effect.gen(function* () {
    const { bytes, resolved, append } = write;
    const keep = bytes.length > WRITE_CHUNK;
    const reply = yield* Effect.promise(() =>
      write.connection.request(
        "write",
        { path: resolved, append, keep },
        { payload: bytes.subarray(0, WRITE_CHUNK) },
      ),
    );
    if (!keep) return;
    const handle = new Handle(write.connection, reply, resolved);
    const inFlight: Promise<Reply>[] = [];
    yield* writeChunks(write, handle, inFlight).pipe(
      Effect.ensuring(
        Effect.promise(() => Promise.allSettled(inFlight)).pipe(
          Effect.andThen(Effect.promise(() => handle.close())),
        ),
      ),
    );
  });

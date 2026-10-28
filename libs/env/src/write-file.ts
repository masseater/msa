import env from "@msa/durable/env";
import type envTypes from "@msa/durable/env.types";
import { Effect } from "effect";

import type connectionTypes from "./connection.types.ts";
import Handle from "./handle.ts";
import type handleTypes from "./handle.types.ts";
import type writeFileTypes from "./write-file.types.ts";

const { FileError } = env;

const WRITE_CHUNK = 512 * 1024;
const WRITE_DEPTH = 8;

const abortedWrite = (
  write: writeFileTypes.FileWrite,
  inFlight: readonly Promise<connectionTypes.Reply>[],
): Effect.Effect<never, envTypes.FileError> =>
  Effect.promise(() => Promise.allSettled(inFlight)).pipe(
    Effect.flatMap((settled) => {
      const failed = settled.find((result) => result.status === "rejected");
      return failed === undefined
        ? Effect.fail(FileError.create("aborted", "The operation was aborted", write.resolved))
        : Effect.die(failed.reason);
    }),
  );

const writeChunks = (
  write: writeFileTypes.FileWrite,
  handle: handleTypes.Handle,
  inFlight: Promise<connectionTypes.Reply>[],
): Effect.Effect<void, envTypes.FileError> =>
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

const writeContent = (write: writeFileTypes.FileWrite): Effect.Effect<void, envTypes.FileError> =>
  Effect.gen(function* () {
    const { bytes, resolved, append } = write;
    const keep = bytes.length > WRITE_CHUNK;
    const reply = yield* Effect.promise(() =>
      write.connection.request(
        "write",
        { append, keep, path: resolved },
        { payload: bytes.subarray(0, WRITE_CHUNK) },
      ),
    );
    if (!keep) return;
    const handle = new Handle(write.connection, reply, resolved);
    const inFlight: Promise<connectionTypes.Reply>[] = [];
    yield* writeChunks(write, handle, inFlight).pipe(
      Effect.ensuring(
        Effect.promise(() => Promise.allSettled(inFlight)).pipe(
          Effect.andThen(Effect.promise(() => handle.close())),
        ),
      ),
    );
  });

const writeFile = {
  writeContent,
};

export default writeFile;

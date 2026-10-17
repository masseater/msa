import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ExecutionEnv } from "@msa/durable/env";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { context, normalize, pairs } from "./differential-support.ts";
import { windows } from "./environment.ts";

const environments = pairs();
afterAll(environments.close);

interface Rooted {
  readonly env: ExecutionEnv;
  readonly root: string;
}

const writeFifo = (fifo: string, text: string): void => {
  spawn("sh", ["-c", `printf '%s' "$1" > "$2"`, "sh", text, fifo]);
};

const readFifo = ({ env, root }: Rooted): Effect.Effect<Record<string, unknown>> =>
  Effect.gen(function* () {
    const fifo = join(root, "fifo");
    const made = yield* Effect.promise(() => env.exec(["mkfifo", fifo], undefined, context));
    if (!made.ok || made.value.exitCode !== 0) return yield* Effect.die(new Error("mkfifo failed"));
    yield* Effect.promise(() => env.createDir("dir", undefined, context));
    writeFifo(fifo, "fifo text\n");
    const fifoText = yield* Effect.promise(() => env.readTextFile("fifo", context));
    writeFifo(fifo, "fifo bytes");
    const fifoBytes = yield* Effect.promise(() => env.readBinaryFile("fifo", context));
    writeFifo(fifo, "x");
    const fifoLines = yield* Effect.promise(() => env.readTextLines("fifo", undefined, context));
    return { fifoText, fifoBytes, fifoLines };
  });

const readDirectory = ({ env }: Rooted): Effect.Effect<Record<string, unknown>> =>
  Effect.gen(function* () {
    const dirReader = yield* Effect.promise(() => env.openTextLineReader("dir", context));
    const dirLine = dirReader.ok
      ? yield* Effect.promise(() => dirReader.value.readLine(context))
      : undefined;
    if (dirReader.ok) yield* Effect.promise(() => dirReader.value.close(context));
    return { dirReaderOpened: dirReader.ok, dirLine };
  });

const specialReads = (rooted: Rooted): Effect.Effect<unknown> =>
  Effect.gen(function* () {
    const { env } = rooted;
    const fifo = yield* readFifo(rooted);
    const dir = yield* readDirectory(rooted);
    return normalize(
      {
        nullText: yield* Effect.promise(() => env.readTextFile("/dev/null", context)),
        nullBytes: yield* Effect.promise(() => env.readBinaryFile("/dev/null", context)),
        nullLines: yield* Effect.promise(() => env.readTextLines("/dev/null", undefined, context)),
        ...fifo,
        ...dir,
        dirText: yield* Effect.promise(() => env.readTextFile("dir", context)),
        dirBytes: yield* Effect.promise(() => env.readBinaryFile("dir", context)),
      },
      rooted.root,
    );
  });

const devicesLikeNode = Effect.gen(function* () {
  const { local, remote, roots } = environments.pair();
  const remoteResults = yield* specialReads({ env: remote, root: roots[1] });
  const localResults = yield* specialReads({ env: local, root: roots[0] });
  expect(remoteResults).toEqual(localResults);
});

const NON_UTF8 = [[0x62], [0x61, 0xff], [0xc3, 0xa9], [0x61, 0xfe, 0x7a], [0x7a]];

const listing = ({ env, root }: Rooted): Effect.Effect<unknown> =>
  Effect.gen(function* () {
    const reader = yield* Effect.promise(() => env.openDirReader(".", context));
    const pages: unknown[] = [];
    if (reader.ok) {
      for (let done = false; !done;) {
        const page = yield* Effect.promise(() => reader.value.next(2, context));
        pages.push(page);
        done = !page.ok || page.value.done;
      }
      yield* Effect.promise(() => reader.value.close(context));
    }
    const list = yield* Effect.promise(() => env.listDir(".", context));
    return normalize({ list, pages }, root);
  });

const namesLikeNode = Effect.gen(function* () {
  const { local, remote, roots } = environments.pair();
  for (const root of roots) {
    for (const name of NON_UTF8) {
      writeFileSync(Buffer.concat([Buffer.from(`${root}/`), Buffer.from(name)]), "x");
    }
  }
  const remoteResults = yield* listing({ env: remote, root: roots[1] });
  const localResults = yield* listing({ env: local, root: roots[0] });
  expect(remoteResults).toEqual(localResults);
});

const linux = process.platform === "linux" || process.platform === "android";

describe("RemoteExecutionEnv against NodeExecutionEnv", () => {
  it.skipIf(windows)(
    "reads devices, FIFOs and directories like Node",
    () => Effect.runPromise(devicesLikeNode),
    30_000,
  );
  it.skipIf(!linux)("lists names that are not UTF-8 like Node", () =>
    Effect.runPromise(namesLikeNode),
  );
});

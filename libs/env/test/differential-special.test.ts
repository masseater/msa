import type envTypes from "@msa/durable/env.types";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import differentialSupport from "./differential-support.ts";
import type differentialSupportTypes from "./differential-support.types.ts";
import environment from "./environment.ts";
import platformModule from "./platform.ts";

const { context, normalize, pairs } = differentialSupport;
const { windows } = environment;
const { localPath, runStatus } = platformModule;

const environments = pairs();
afterAll(environments.close);

interface Rooted {
  readonly env: envTypes.ExecutionEnv;
  readonly root: differentialSupportTypes.Root;
}

const writeFifo = (fifo: string, text: string): Effect.Effect<void> =>
  Effect.asVoid(
    Effect.forkDetach(runStatus(["sh", "-c", `printf '%s' "$1" > "$2"`, "sh", text, fifo])),
  );

const readFifo = ({ env, root }: Rooted): Effect.Effect<Record<string, unknown>> =>
  Effect.gen(function* () {
    const fifo = localPath.join(root.path, "fifo");
    const made = yield* Effect.promise(() => env.exec(["mkfifo", fifo], undefined, context));
    if (!made.ok || made.value.exitCode !== 0) return yield* Effect.die(new Error("mkfifo failed"));
    yield* Effect.promise(() => env.createDir("dir", undefined, context));
    yield* writeFifo(fifo, "fifo text\n");
    const fifoText = yield* Effect.promise(() => env.readTextFile("fifo", context));
    yield* writeFifo(fifo, "fifo bytes");
    const fifoBytes = yield* Effect.promise(() => env.readBinaryFile("fifo", context));
    yield* writeFifo(fifo, "x");
    const fifoLines = yield* Effect.promise(() => env.readTextLines("fifo", undefined, context));
    return { fifoBytes, fifoLines, fifoText };
  });

const readDirectory = ({ env }: Rooted): Effect.Effect<Record<string, unknown>> =>
  Effect.gen(function* () {
    const dirReader = yield* Effect.promise(() => env.openTextLineReader("dir", context));
    const dirLine = dirReader.ok
      ? yield* Effect.promise(() => dirReader.value.readLine(context))
      : undefined;
    if (dirReader.ok) yield* Effect.promise(() => dirReader.value.close(context));
    return { dirLine, dirReaderOpened: dirReader.ok };
  });

const specialReads = (rooted: Rooted): Effect.Effect<unknown> =>
  Effect.gen(function* () {
    const { env } = rooted;
    const fifo = yield* readFifo(rooted);
    const dir = yield* readDirectory(rooted);
    return normalize(
      {
        nullBytes: yield* Effect.promise(() => env.readBinaryFile("/dev/null", context)),
        nullLines: yield* Effect.promise(() => env.readTextLines("/dev/null", undefined, context)),
        nullText: yield* Effect.promise(() => env.readTextFile("/dev/null", context)),
        ...fifo,
        ...dir,
        dirBytes: yield* Effect.promise(() => env.readBinaryFile("dir", context)),
        dirText: yield* Effect.promise(() => env.readTextFile("dir", context)),
      },
      rooted.root,
    );
  });

const devicesLikeNode = Effect.gen(function* () {
  const { local, remote, roots } = yield* environments.pair;
  const remoteResults = yield* specialReads({ env: remote, root: roots[1] });
  const localResults = yield* specialReads({ env: local, root: roots[0] });
  expect(remoteResults).toEqual(localResults);
});

const NON_UTF8 = [[0x62], [0x61, 0xff], [0xc3, 0xa9], [0x61, 0xfe, 0x7a], [0x7a]];

const octal = (bytes: readonly number[]): string =>
  bytes.map((byte) => `\\${byte.toString(8).padStart(3, "0")}`).join("");

const writeNamed = (root: string, name: readonly number[]): Effect.Effect<void> =>
  Effect.asVoid(
    runStatus(["sh", "-c", `cd "$1" && printf x > "$(printf '${octal(name)}')"`, "sh", root]),
  );

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
  const { local, remote, roots } = yield* environments.pair;
  for (const root of roots) {
    for (const name of NON_UTF8) yield* writeNamed(root.path, name);
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

import contextModule from "@msa/chord/context";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import clockModule from "../src/clock.ts";
import envModule from "../src/env/index.ts";
import type envTypes from "../src/env/index.types.ts";
import node from "../src/env/node.ts";
import nodeProcess from "../src/env/node/node-process.ts";
import testing from "../src/testing/index.ts";
import testSupport from "./support.ts";

const { BACKGROUND_CONTEXT } = contextModule;

const { environmentVariable } = nodeProcess;
const { registerEnvConformance } = testing;
const { NodeExecutionEnv } = node;
const { getOrThrow } = envModule;
const { currentTimeMillis } = clockModule;

const { awaited } = testSupport;
const { joinPath, makeTempDir, removeDirRetrying, runCommandOrFail, writeBytes } = testSupport;

const windows = process.platform === "win32";
const gitBash = joinPath(
  environmentVariable("ProgramFiles", true) ?? "C:\\Program Files",
  "Git",
  "bin",
  "bash.exe",
);
const context = BACKGROUND_CONTEXT;

const withEnvDir = <A, E>(prefix: string, use: (cwd: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(makeTempDir(prefix), use, removeDirRetrying);

registerEnvConformance(
  { describe, expect, it },
  "NodeExecutionEnv conformance",
  (use) =>
    Effect.runPromise(
      withEnvDir("msa-durable-env-conformance-", (cwd) =>
        awaited(use(new NodeExecutionEnv({ cwd }))),
      ),
    ),
  windows ? { shell: [gitBash, "-c"], symlinks: false } : {},
);

registerEnvConformance(
  { describe, expect, it },
  "NodeExecutionEnv conformance with polling watches",
  (use) =>
    Effect.runPromise(
      withEnvDir("msa-durable-env-conformance-", (cwd) =>
        awaited(
          use(new NodeExecutionEnv({ cwd, watch: { mode: "polling", pollIntervalMs: 100 } })),
        ),
      ),
    ),
  windows ? { shell: [gitBash, "-c"], symlinks: false } : {},
);

const refusesTreeOver = withEnvDir("msa-durable-env-watch-", (cwd) =>
  Effect.gen(function* () {
    const env = new NodeExecutionEnv({ cwd, watch: { maxDirectories: 3 } });
    getOrThrow(yield* awaited(env.createDir("tree/a/b", undefined, context)));
    getOrThrow(yield* awaited(env.createDir("tree/c", undefined, context)));
    expect(
      yield* awaited(env.watch([{ path: "tree", recursive: true }], () => {}, context)),
    ).toMatchObject({
      error: { code: "invalid" },
      ok: false,
    });

    getOrThrow(yield* awaited(env.remove("tree/c", { recursive: true }, context)));
    const changes: envTypes.WatchChange[] = [];
    const watcher = getOrThrow(
      yield* awaited(
        env.watch([{ path: "tree", recursive: true }], (change) => changes.push(change), context),
      ),
    );
    getOrThrow(yield* awaited(env.createDir("tree/d", undefined, context)));
    const deadline = currentTimeMillis() + 3000;
    while (!changes.some((change) => "error" in change) && currentTimeMillis() < deadline)
      yield* Effect.sleep(20);
    expect(changes.at(-1)).toMatchObject({ error: { code: "invalid" } });
    yield* awaited(watcher.close(context));
  }),
);

describe("NodeExecutionEnv watch limits", () => {
  it("refuses a tree over the directory budget and stops with an error when one grows past it", () =>
    Effect.runPromise(refusesTreeOver));
});

describe("NodeExecutionEnv readers", () => {
  const dirs: string[] = [];
  const tempDir = makeTempDir("msa-durable-env-readers-").pipe(
    Effect.tap((dir) => Effect.sync(() => dirs.push(dir))),
  );
  afterEach(
    () => Effect.runPromise(Effect.forEach(dirs.splice(0), removeDirRetrying, { discard: true })),
    15_000,
  );

  it("reads ranges spanning several internal chunks exactly", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cwd = yield* tempDir;
        const bytes = new Uint8Array(2.5 * 1024 * 1024);
        for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 31) % 251;
        yield* writeBytes(joinPath(cwd, "big.bin"), bytes);
        const reader = getOrThrow(
          yield* awaited(
            new NodeExecutionEnv({ cwd }).openBinaryReader("big.bin", undefined, context),
          ),
        );
        yield* Effect.gen(function* () {
          const all = getOrThrow(yield* awaited(reader.read(0, bytes.length + 10, context)));
          expect(all.length).toBe(bytes.length);
          expect(Buffer.from(all).equals(Buffer.from(bytes))).toBe(true);
          const middle = getOrThrow(yield* awaited(reader.read(1024 * 1024 - 3, 7, context)));
          expect([...middle]).toEqual([...bytes.subarray(1024 * 1024 - 3, 1024 * 1024 + 4)]);
        }).pipe(
          Effect.ensuring(Effect.asVoid(Effect.suspend(() => awaited(reader.close(context))))),
        );
      }),
    ));

  it.skipIf(windows)("refuses a FIFO without waiting for a writer", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cwd = yield* tempDir;
        yield* runCommandOrFail("mkfifo", [joinPath(cwd, "pipe")]);
        const result = yield* awaited(
          new NodeExecutionEnv({ cwd }).openBinaryReader("pipe", undefined, context),
        );
        expect(result).toMatchObject({ error: { code: "invalid" }, ok: false });
      }),
    ),
  );
});

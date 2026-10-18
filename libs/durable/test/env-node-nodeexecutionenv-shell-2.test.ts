import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { toJsonText, awaited } from "./effect-support.ts";
import {
  cleanUpEnvTests,
  tempDirs,
  createTempDir,
  collectShellOutput,
} from "./env-node-support.ts";
import { joinPath } from "./platform-support.ts";

class FailingSpillExecutionEnv extends NodeExecutionEnv {
  override createTempFile(
    options: Parameters<NodeExecutionEnv["createTempFile"]>[0],
    context: Parameters<NodeExecutionEnv["createTempFile"]>[1],
  ) {
    if (options?.prefix === "msa-output-") {
      return Promise.resolve({
        ok: true as const,
        value: joinPath(this.cwd, "missing", "spill.log"),
      });
    }
    return Promise.resolve(super.createTempFile(options, context));
  }
}

afterEach(() => Effect.runPromise(cleanUpEnvTests), 15_000);

const reportsSpillCommand = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  const result = yield* awaited(
    env.exec(
      "printf 12345678901234567890; sleep 5",
      { timeout: 0.3, spill: { afterBytes: 10, afterLines: 10 } },
      BACKGROUND_CONTEXT,
    ),
  );
  expect(result).toMatchObject({
    ok: false,
    error: { code: "timeout", spillPath: expect.any(String) },
  });
  const spillPath = (result as { error: { spillPath: string } }).error.spillPath;
  tempDirs.push(joinPath(spillPath, ".."));
  expect(getOrThrow(yield* awaited(env.readTextFile(spillPath, BACKGROUND_CONTEXT)))).toBe(
    "12345678901234567890",
  );
});

const failsRatherSilently = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new FailingSpillExecutionEnv({ cwd: root });
  const result = yield* awaited(
    env.exec(
      "printf 12345678901234567890",
      {
        spill: { afterBytes: 10, afterLines: 10 },
      },
      BACKGROUND_CONTEXT,
    ),
  );
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: "unknown",
      message: expect.stringContaining("Failed to preserve complete shell output"),
    },
  });
});

describe("NodeExecutionEnv shell", () => {
  it("reports the spill of a command that times out", () => Effect.runPromise(reportsSpillCommand));

  it("fails rather than silently losing a requested spill", () =>
    Effect.runPromise(failsRatherSilently));
});

const preservesCompleteLarge = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  const size = 500_000;
  const result = getOrThrow(
    yield* awaited(
      env.exec(
        `${yield* toJsonText(process.execPath)} -e "process.stdout.write('x'.repeat(${size}))"`,
        {
          spill: { afterBytes: 10, afterLines: 10 },
        },
        BACKGROUND_CONTEXT,
      ),
    ),
  );
  expect(result.spillPath).toBeDefined();
  tempDirs.push(joinPath(result.spillPath!, ".."));
  expect(
    getOrThrow(yield* awaited(env.readTextFile(result.spillPath!, BACKGROUND_CONTEXT))),
  ).toHaveLength(size);
});

const streamsEveryLine = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  const collected = yield* awaited(
    collectShellOutput(
      env,
      "i=1; while [ $i -le 15000 ]; do echo line-$i; i=$((i+1)); done",
      { spill: { afterBytes: 1024 * 1024, afterLines: 100 } },
      BACKGROUND_CONTEXT,
    ),
  );
  const result = getOrThrow(collected.result);
  expect(collected.output).toBe(
    Array.from({ length: 15000 }, (_, index) => `line-${index + 1}\n`).join(""),
  );
  expect(result.spillPath).toBeDefined();
  tempDirs.push(joinPath(result.spillPath!, ".."));
  const spilled = getOrThrow(
    yield* awaited(env.readTextLines(result.spillPath!, undefined, BACKGROUND_CONTEXT)),
  );
  expect(spilled).toHaveLength(15000);
  expect(spilled.at(-1)).toBe("line-15000");
});

describe("NodeExecutionEnv shell", () => {
  it(
    "preserves complete large output in the spill",
    () => Effect.runPromise(preservesCompleteLarge),
    20_000,
  );

  it("streams every line and spills them all once output crosses its line threshold", () =>
    Effect.runPromise(streamsEveryLine));
});

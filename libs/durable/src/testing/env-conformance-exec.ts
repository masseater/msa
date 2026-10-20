import contextModule from "@msa/chord/context";
import { Effect, Exit, Scope } from "effect";

import envModule from "../env/index.ts";
import type envTypes from "../env/index.types.ts";
import envConformanceSupport from "./env-conformance-support.ts";
import type envConformanceSupportTypes from "./env-conformance-support.types.ts";

const { withAbortSignal } = contextModule;

const { codeOf, context, encoder, execCollect, value } = envConformanceSupport;
const { getOrThrow } = envModule;

const argvWithoutShell: envConformanceSupportTypes.EnvCaseSpec = {
  name: "argv exec passes arguments to the program without shell parsing",
  test: (env, { assert, shell }) =>
    Effect.gen(function* () {
      const hostile = "it's $(touch pwned) `touch pwned` *; touch pwned";
      const { result, stdout } = yield* execCollect(env, [
        ...shell,
        'printf "%s|%s" "$1" "$2"',
        "argv0",
        hostile,
        "a b",
      ]);
      assert.strictEqual(getOrThrow(result).exitCode, 0);
      assert.strictEqual(stdout, `${hostile}|a b`);
      assert.strictEqual(yield* value(() => env.exists("pwned", context)), false);
    }),
};

const streams: envConformanceSupportTypes.EnvCaseSpec = {
  name: "exec reports the stream of every chunk in both forms",
  test: (env, { assert, shell }) =>
    Effect.gen(function* () {
      const script = "printf out; printf err >&2; printf more";
      for (const command of [[...shell, script], script]) {
        const collected = yield* execCollect(env, command);
        assert.strictEqual(getOrThrow(collected.result).exitCode, 0);
        assert.strictEqual(collected.stdout, "outmore");
        assert.strictEqual(collected.stderr, "err");
      }
    }),
};

const cwdAndExitCode: envConformanceSupportTypes.EnvCaseSpec = {
  name: "argv exec honors cwd and exit codes",
  test: (env, { assert, shell }) =>
    Effect.gen(function* () {
      yield* value(() => env.createDir("sub", undefined, context));
      const made = yield* execCollect(env, [...shell, "printf x > made.txt; exit 3"], "sub");
      assert.strictEqual(getOrThrow(made.result).exitCode, 3);
      assert.strictEqual(yield* value(() => env.readTextFile("sub/made.txt", context)), "x");
    }),
};

const spawnErrors: envConformanceSupportTypes.EnvCaseSpec = {
  name: "argv exec reports missing programs and empty argv as spawn errors",
  test: (env, { assert }) =>
    Effect.gen(function* () {
      assert.strictEqual(
        yield* codeOf(() =>
          env.exec(["msa-durable-conformance-missing-program"], undefined, context),
        ),
        "spawn_error",
      );
      assert.strictEqual(yield* codeOf(() => env.exec([], undefined, context)), "spawn_error");
    }),
};

const windowLines = 2000;
const outputWindow = {
  bytesPerSecond: 1_000_000_000,
  maxBytes: 200,
  maxLines: 5,
  minIntervalMs: 0,
};

const windowCounter = ({ assert }: envConformanceSupportTypes.EnvSuite) => {
  const seen = { bytes: 0, newlines: 0, tail: "" };
  const onOutput = (text: string, _context: unknown, info: envTypes.ShellOutputInfo) => {
    if (info.skipped !== undefined) {
      seen.bytes += info.skipped.bytes;
      seen.newlines += info.skipped.newlines;
      const after = encoder.encode(text).length;
      const afterNewlines = text.split("\n").length - 1;
      assert.ok(
        after > outputWindow.maxBytes || afterNewlines > outputWindow.maxLines,
        "a skip is followed by more than the window",
      );
      seen.tail = "";
    }
    seen.bytes += encoder.encode(text).length;
    seen.newlines += text.split("\n").length - 1;
    seen.tail += text;
  };
  return { onOutput, seen };
};

const windowedTail: envConformanceSupportTypes.EnvCaseSpec = {
  name: "windowed exec keeps the exact tail and counts what it skips",
  test: (env, suite) =>
    Effect.gen(function* () {
      const { assert, shell } = suite;
      const { seen, onOutput } = windowCounter(suite);
      const script = `i=0; while [ $i -lt ${windowLines} ]; do echo line-$i; i=$((i+1)); done`;
      const result = yield* value(() =>
        env.exec([...shell, script], { onOutput, window: outputWindow }, context),
      );
      assert.strictEqual(result.exitCode, 0);
      const expected = Array.from({ length: windowLines }, (_, index) => `line-${index}\n`);
      assert.strictEqual(seen.bytes, expected.join("").length);
      assert.strictEqual(seen.newlines, windowLines);
      assert.ok(
        seen.tail.endsWith(expected.slice(-outputWindow.maxLines).join("")),
        "the delivered output ends with the tail",
      );
    }),
};

const timeoutAndAbort: envConformanceSupportTypes.EnvCaseSpec = {
  name: "argv exec distinguishes timeout from abort",
  test: (env, { assert, shell }) =>
    Effect.gen(function* () {
      const timedOut = yield* codeOf(() =>
        env.exec([...shell, "sleep 2"], { timeout: 0.1 }, context),
      );
      assert.strictEqual(timedOut, "timeout");
      const scope = yield* Scope.make();
      const signal = yield* Scope.provide(Effect.abortSignal, scope);
      const running = env.exec([...shell, "sleep 2"], undefined, withAbortSignal(signal, context));
      yield* Effect.sleep(100);
      yield* Scope.close(scope, Exit.void);
      assert.strictEqual(yield* codeOf(() => running), "aborted");
    }),
};

const execCases: readonly envConformanceSupportTypes.EnvCaseSpec[] = [
  argvWithoutShell,
  streams,
  cwdAndExitCode,
  spawnErrors,
  windowedTail,
  timeoutAndAbort,
];

const envConformanceExec = {
  execCases,
};

export default envConformanceExec;

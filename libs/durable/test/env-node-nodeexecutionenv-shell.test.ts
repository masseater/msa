import contextModule from "@msa/chord/context";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import envModule from "../src/env/index.ts";
import node from "../src/env/node.ts";
import effectSupport from "./effect-support.ts";
import envNodeSupport from "./env-node-support.ts";
import platformSupport from "./platform-support.ts";

const { BACKGROUND_CONTEXT, withAbortSignal } = contextModule;

const { NodeExecutionEnv } = node;
const { getOrThrow } = envModule;

const { abortController, awaited, toJsonText } = effectSupport;
const {
  abortedContext,
  cleanUpEnvTests,
  collectShellOutput,
  createTempDir,
  toBashSingleQuotedArg,
} = envNodeSupport;
const { joinPath, pathExists, readText } = platformSupport;

afterEach(() => Effect.runPromise(cleanUpEnvTests), 15_000);

const fakeWindowsShell = Effect.gen(function* () {
  const root = yield* createTempDir;
  const pidFile = joinPath(root, "shell.pid");
  const controller = abortController();
  const env = new NodeExecutionEnv({ cwd: root, shellPath: "/bin/bash" });
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  vi.stubEnv("SystemRoot", "/definitely/missing/windows");
  Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
  return { controller, env, pidFile, platformDescriptor };
});

const streamsCombinedStdout = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  const collected = yield* awaited(
    collectShellOutput(env, "printf out; printf err >&2", undefined, BACKGROUND_CONTEXT),
  );
  expect(getOrThrow(collected.result)).toEqual({ exitCode: 0 });
  expect(collected.output).toContain("out");
  expect(collected.output).toContain("err");
});

const decodesUtf8 = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  const script =
    "const b=Buffer.from('😀');process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),50)";
  const collected = yield* awaited(
    collectShellOutput(
      env,
      `${yield* toJsonText(process.execPath)} -e ${yield* toJsonText(script)}`,
      undefined,
      BACKGROUND_CONTEXT,
    ),
  );
  expect(collected.output).toBe("😀");
});

const reportsMissingWorking = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: joinPath(root, "missing") });
  const result = yield* awaited(env.exec("printf ok", undefined, BACKGROUND_CONTEXT));

  expect(result).toMatchObject({
    error: {
      code: "spawn_error",
      message: expect.stringContaining("Working directory does not exist"),
    },
    ok: false,
  });
});

const returnsNonZero = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  const result = getOrThrow(yield* awaited(env.exec("exit 7", undefined, BACKGROUND_CONTEXT)));
  expect(result).toEqual({ exitCode: 7 });
});

describe("NodeExecutionEnv shell", () => {
  it("streams combined stdout and stderr", () => Effect.runPromise(streamsCombinedStdout));

  it("decodes UTF-8 split across raw process chunks", () => Effect.runPromise(decodesUtf8), 20_000);

  it("reports a missing working directory before spawning", () =>
    Effect.runPromise(reportsMissingWorking));

  it("returns non-zero command exit codes as successful execution results", () =>
    Effect.runPromise(returnsNonZero));
});

const returnsTimeoutErrors = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  const result = yield* awaited(env.exec("sleep 5", { timeout: 0.01 }, BACKGROUND_CONTEXT));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toMatchObject({ code: "timeout" });
});

const rejectsInvalidTimeouts = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  for (const timeout of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_484]) {
    expect(
      yield* awaited(env.exec("touch spawned", { timeout }, BACKGROUND_CONTEXT)),
    ).toMatchObject({
      error: { code: "timeout", message: expect.stringContaining("Invalid timeout") },
      ok: false,
    });
  }
  expect(getOrThrow(yield* awaited(env.exists("spawned", BACKGROUND_CONTEXT)))).toBe(false);
});

const returnsCallbackErrors = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  const result = yield* awaited(
    env.exec(
      "printf out",
      {
        onOutput: () => {
          throw new Error("callback failed");
        },
      },
      BACKGROUND_CONTEXT,
    ),
  );
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(result.error).toMatchObject({
      code: "callback_error",
      message: "callback failed",
    });
});

describe("NodeExecutionEnv shell", () => {
  it.skipIf(process.platform === "win32")(
    "maps signal-killed processes to a non-zero exit code",
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const root = yield* createTempDir;
          const env = new NodeExecutionEnv({ cwd: root });
          const result = getOrThrow(
            yield* awaited(env.exec("kill -9 $$", undefined, BACKGROUND_CONTEXT)),
          );
          expect(result.exitCode).toBe(128 + 9);
        }),
      ),
  );

  it("returns timeout errors for commands exceeding the timeout", () =>
    Effect.runPromise(returnsTimeoutErrors));

  it("rejects invalid timeouts before spawning", () => Effect.runPromise(rejectsInvalidTimeouts));

  it("returns callback errors from exec stream handlers", () =>
    Effect.runPromise(returnsCallbackErrors));
});

const returnsShellUnavailable = Effect.gen(function* () {
  const root = yield* createTempDir;
  const missingShellEnv = new NodeExecutionEnv({
    cwd: root,
    shellPath: joinPath(root, "missing-shell"),
  });
  const missingShell = yield* awaited(
    missingShellEnv.exec("printf ok", undefined, BACKGROUND_CONTEXT),
  );
  expect(missingShell.ok).toBe(false);
  if (!missingShell.ok) expect(missingShell.error).toMatchObject({ code: "shell_unavailable" });

  const shellPath = joinPath(root, "not-executable-shell");
  const env = new NodeExecutionEnv({ cwd: root });
  getOrThrow(yield* awaited(env.writeFile(shellPath, "not executable", BACKGROUND_CONTEXT)));
  const spawnErrorEnv = new NodeExecutionEnv({ cwd: root, shellPath });
  const spawnError = yield* awaited(spawnErrorEnv.exec("printf ok", undefined, BACKGROUND_CONTEXT));
  expect(spawnError.ok).toBe(false);
  if (!spawnError.ok) expect(spawnError.error).toMatchObject({ code: "spawn_error" });
});

const returnsAbortedResult = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  expect(yield* awaited(env.exec("touch spawned", undefined, abortedContext()))).toMatchObject({
    error: { code: "aborted" },
    ok: false,
  });
  expect(getOrThrow(yield* awaited(env.exists("spawned", BACKGROUND_CONTEXT)))).toBe(false);

  const controller = abortController();
  const promise = env.exec(
    "sleep 5",
    undefined,
    withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
  );
  controller.abort();
  const result = yield* awaited(promise);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toMatchObject({ code: "aborted" });
});

describe("NodeExecutionEnv shell", () => {
  it("returns shell unavailable and spawn errors", () =>
    Effect.runPromise(returnsShellUnavailable));

  it("returns an aborted result for pre-aborted and aborted commands", () =>
    Effect.runPromise(returnsAbortedResult));
});

describe("NodeExecutionEnv shell", () => {
  it.skipIf(process.platform === "win32")(
    "ignores asynchronous taskkill spawn errors during abort",
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const { pidFile, controller, env, platformDescriptor } = yield* fakeWindowsShell;

          let pid: number | undefined;
          yield* Effect.gen(function* () {
            const execution = env.exec(
              `echo $$ > ${toBashSingleQuotedArg(pidFile)}; exec sleep 60`,
              undefined,
              withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
            );
            for (let attempt = 0; attempt < 100 && !(yield* pathExists(pidFile)); attempt++)
              yield* Effect.sleep(10);
            expect(yield* pathExists(pidFile)).toBe(true);

            controller.abort();
            yield* Effect.sleep(1);
            pid = Number.parseInt(yield* readText(pidFile), 10);
            process.kill(pid, "SIGKILL");

            const result = yield* awaited(execution);
            expect(result).toMatchObject({ error: { code: "aborted" }, ok: false });
          }).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                if (pid === undefined && (yield* pathExists(pidFile))) {
                  pid = Number.parseInt(yield* readText(pidFile), 10);
                }
                const target = pid;
                if (target !== undefined && Number.isFinite(target))
                  yield* Effect.ignore(Effect.try(() => process.kill(target, "SIGKILL")));
                vi.unstubAllEnvs();
                if (platformDescriptor !== undefined)
                  Object.defineProperty(process, "platform", platformDescriptor);
              }),
            ),
          );
        }),
      ),
  );
});

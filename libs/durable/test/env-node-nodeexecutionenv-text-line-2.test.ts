import { BACKGROUND_CONTEXT, withAbortSignal } from "@msa/chord/context";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import clockModule from "../src/clock.ts";
import envModule from "../src/env/index.ts";
import node from "../src/env/node.ts";
import effectSupport from "./effect-support.ts";
import envNodeSupport from "./env-node-support.ts";
import platformSupport from "./platform-support.ts";

const { currentTimeMillis } = clockModule;
const { NodeExecutionEnv } = node;
const { getOrThrow } = envModule;

const { abortController, awaited } = effectSupport;
const { cleanUpEnvTests, collectShellOutput, createTempDir, toBashSingleQuotedArg } =
  envNodeSupport;
const { joinPath, pathExists, readText, runCommand } = platformSupport;

const waitFor = Effect.fn("waitFor")(function* (
  condition: Effect.Effect<boolean>,
  timeoutMs: number,
) {
  const deadline = currentTimeMillis() + timeoutMs;
  while (!(yield* condition)) {
    if (currentTimeMillis() > deadline) throw new Error(`Condition not met within ${timeoutMs}ms`);
    yield* Effect.sleep(10);
  }
});

const withTimeout = <T>(promise: Promise<T>, ms: number, onTimeout: () => void = () => {}) =>
  awaited(promise).pipe(
    Effect.timeoutOrElse({
      duration: ms,
      orElse: () =>
        Effect.sync(onTimeout).pipe(
          Effect.andThen(Effect.die(new Error(`Timed out after ${ms}ms`))),
        ),
    }),
  );

function createInheritedStdioCommand(pidFile: string): string {
  return (
    'node -e "' +
    "const fs=require('fs');" +
    "const {spawn}=require('child_process');" +
    "const child=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'inherit',detached:true});" +
    "fs.writeFileSync(process.argv[1], String(child.pid));" +
    "child.unref();" +
    "console.log('child-exiting');" +
    '" ' +
    toBashSingleQuotedArg(pidFile)
  );
}

const cleanupDetachedChild = Effect.fn("cleanupDetachedChild")(function* (pidFile: string) {
  if (!(yield* pathExists(pidFile))) return;
  const pid = Number.parseInt((yield* readText(pidFile)).trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) return;
  yield* Effect.exit(runCommand("taskkill", ["/F", "/T", "/PID", String(pid)]));
});

afterEach(() => Effect.runPromise(cleanUpEnvTests), 15_000);

const cleanupTerminatesActive = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  const execution = env.exec("touch started; sleep 60", undefined, BACKGROUND_CONTEXT);
  yield* Effect.asVoid(
    Effect.suspend(() =>
      waitFor(
        Effect.suspend(() => awaited(env.exists("started", BACKGROUND_CONTEXT))).pipe(
          Effect.map(getOrThrow),
        ),
        10_000,
      ),
    ),
  ).pipe(
    Effect.ensuring(Effect.asVoid(Effect.suspend(() => awaited(env.cleanup(BACKGROUND_CONTEXT))))),
  );
  expect(yield* withTimeout(execution, 3000)).toMatchObject({ ok: true });
});

describe("NodeExecutionEnv shell", () => {
  it.skipIf(process.platform !== "win32")(
    "settles after the shell exits when a detached descendant retains inherited stdio",
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const root = yield* createTempDir;
          const pidFile = joinPath(root, "grandchild.pid");
          const env = new NodeExecutionEnv({ cwd: root });
          const controller = abortController();
          yield* Effect.gen(function* () {
            const collected = yield* withTimeout(
              collectShellOutput(
                env,
                createInheritedStdioCommand(pidFile),
                undefined,
                withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
              ),
              3000,
              () => controller.abort(),
            );
            getOrThrow(collected.result);
            expect(collected.output).toContain("child-exiting");
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => controller.abort()).pipe(
                Effect.andThen(cleanupDetachedChild(pidFile)),
              ),
            ),
          );
        }),
      ),
  );

  it(
    "cleanup terminates active shell processes",
    () => Effect.runPromise(cleanupTerminatesActive),
    20_000,
  );
});

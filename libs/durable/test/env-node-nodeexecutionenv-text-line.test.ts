import { BACKGROUND_CONTEXT, withAbortSignal } from "@msa/chord/context";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { currentTimeMillis } from "../src/clock.ts";
import { getOrThrow } from "../src/env/index.ts";
import { environmentVariable } from "../src/env/node-process.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { abortController, awaited } from "./effect-support.ts";
import {
  cleanUpEnvTests,
  createTempDir,
  collectShellOutput,
  toBashSingleQuotedArg,
} from "./env-node-support.ts";
import {
  changeMode,
  joinPath,
  pathDelimiter,
  pathExists,
  readText,
  realPath,
  runCommand,
} from "./platform-support.ts";

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

const rejectsReadsClose = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  getOrThrow(yield* awaited(env.writeFile("lines.txt", "one\n", BACKGROUND_CONTEXT)));
  const reader = getOrThrow(
    yield* awaited(env.openTextLineReader("lines.txt", BACKGROUND_CONTEXT)),
  );
  yield* awaited(reader.close(BACKGROUND_CONTEXT));
  yield* awaited(expect(reader.close(BACKGROUND_CONTEXT)).resolves.toBeUndefined());
  expect(yield* awaited(reader.readLine(BACKGROUND_CONTEXT))).toMatchObject({
    ok: false,
    error: { code: "invalid", path: joinPath(root, "lines.txt") },
  });
});

const reportsMissingFiles = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  expect(yield* awaited(env.openTextLineReader("missing.txt", BACKGROUND_CONTEXT))).toMatchObject({
    ok: false,
    error: { code: "not_found", path: joinPath(root, "missing.txt") },
  });
});

describe("NodeExecutionEnv text line reader", () => {
  it("rejects reads after close and closes idempotently", () =>
    Effect.runPromise(rejectsReadsClose));

  it("reports missing files when opening a reader", () => Effect.runPromise(reportsMissingFiles));
});

const executesCommandsCwd = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  const collected = yield* awaited(
    collectShellOutput(
      env,
      'printf \'%s\' "$NODE_ENV_TEST" > cwd-marker.txt; printf \'%s:%s\' "$PWD" "$NODE_ENV_TEST"',
      { env: { NODE_ENV_TEST: "ok" } },
      BACKGROUND_CONTEXT,
    ),
  );
  const result = getOrThrow(collected.result);
  expect(result.exitCode).toBe(0);
  expect(yield* readText(joinPath(root, "cwd-marker.txt"))).toBe("ok");
  if (process.platform !== "win32") expect(collected.output).toBe(`${yield* realPath(root)}:ok`);
});

describe("NodeExecutionEnv shell", () => {
  it("executes commands in cwd with env overrides", () => Effect.runPromise(executesCommandsCwd));

  it.each([
    ["a missing override preserves the base value", undefined, "x:/stale/parent.jsonl"],
    ["an empty override shadows the base value", { MSA_SESSION_FILE: "" }, "x:"],
    [
      "a string override replaces the base value",
      { MSA_SESSION_FILE: "/sessions/current.jsonl" },
      "x:/sessions/current.jsonl",
    ],
  ] as const)(
    "applies string shell environment overrides when %s",
    (_description, overrides, expectedSessionFile) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const root = yield* createTempDir;
          const env = new NodeExecutionEnv({
            cwd: root,
            shellEnv: {
              MSA_SESSION_FILE: "/stale/parent.jsonl",
              MSA_CODING_AGENT: "true",
              MSA_NODE_ENV_PRESERVED_TEST: "preserved",
            },
          });
          const collected = yield* awaited(
            collectShellOutput(
              env,
              `printf '%s:%s|%s|%s' "\${MSA_SESSION_FILE+x}" "\${MSA_SESSION_FILE-}" "$MSA_CODING_AGENT" "$MSA_NODE_ENV_PRESERVED_TEST"`,
              overrides === undefined ? {} : { env: overrides },
              BACKGROUND_CONTEXT,
            ),
          );
          getOrThrow(collected.result);
          expect(collected.output).toBe(`${expectedSessionFile}|true|preserved`);
        }),
      ),
  );
});

const canReplaceRather = Effect.gen(function* () {
  const root = yield* createTempDir;
  const inheritedKey = "MSA_NODE_ENV_INHERITED_TEST";
  const configuredKey = "MSA_NODE_ENV_CONFIGURED_TEST";
  const explicitKey = "MSA_NODE_ENV_EXPLICIT_TEST";
  vi.stubEnv(inheritedKey, "host");
  yield* Effect.gen(function* () {
    const env = new NodeExecutionEnv({
      cwd: root,
      shellEnv: { [configuredKey]: "configured" },
    });
    const collected = yield* awaited(
      collectShellOutput(
        env,
        `printf '%s:%s:%s' "\${${inheritedKey}-}" "\${${configuredKey}-}" "\${${explicitKey}-}"`,
        { inheritEnv: false, env: { [explicitKey]: "explicit" } },
        BACKGROUND_CONTEXT,
      ),
    );
    getOrThrow(collected.result);
    expect(collected.output).toBe("::explicit");
  }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())));
});

describe("NodeExecutionEnv shell", () => {
  it("can replace rather than inherit the default shell environment", () =>
    Effect.runPromise(canReplaceRather));
});

const usesStdinCommand = Effect.gen(function* () {
  if (process.platform === "win32") return;
  const root = yield* createTempDir;
  const shellPath = "C:\\Windows\\System32\\bash.exe";
  const env = new NodeExecutionEnv({ cwd: root });
  getOrThrow(
    yield* awaited(
      env.writeFile(
        shellPath,
        '#!/bin/sh\nprintf \'args:%s\\n\' "$*" >&2\nexec /bin/bash "$@"\n',
        BACKGROUND_CONTEXT,
      ),
    ),
  );
  yield* changeMode(joinPath(root, shellPath), 0o755);

  const originalCwd = process.cwd();
  const originalPath = environmentVariable("PATH", true);
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  yield* Effect.gen(function* () {
    process.chdir(root);
    vi.stubEnv("PATH", `${root}${pathDelimiter}${originalPath ?? ""}`);
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    const wslEnv = new NodeExecutionEnv({ cwd: root, shellPath });
    const nameExpansion = "${name}";
    const collected = yield* awaited(
      collectShellOutput(
        wslEnv,
        `name='World'; echo "Hello, ${nameExpansion}!"`,
        undefined,
        BACKGROUND_CONTEXT,
      ),
    );
    const result = getOrThrow(collected.result);
    expect(collected.output).toContain("Hello, World!");
    expect(collected.output).toContain("args:-s");
    expect(result.exitCode).toBe(0);
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        process.chdir(originalCwd);
        vi.unstubAllEnvs();
        if (platformDescriptor) {
          Object.defineProperty(process, "platform", platformDescriptor);
        }
      }),
    ),
  );
});

describe("NodeExecutionEnv shell", () => {
  it("uses stdin command transport for legacy WSL bash paths", () =>
    Effect.runPromise(usesStdinCommand));
});

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

import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import envModule from "../src/env/index.ts";
import node from "../src/env/node.ts";
import nodeProcess from "../src/env/node/node-process.ts";
import effectSupport from "./effect-support.ts";
import envNodeSupport from "./env-node-support.ts";
import platformSupport from "./platform-support.ts";

const { NodeExecutionEnv } = node;
const { getOrThrow } = envModule;
const { environmentVariable } = nodeProcess;

const { awaited } = effectSupport;
const { cleanUpEnvTests, collectShellOutput, createTempDir } = envNodeSupport;
const { changeMode, joinPath, pathDelimiter, readText, realPath } = platformSupport;

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
    error: { code: "invalid", path: joinPath(root, "lines.txt") },
    ok: false,
  });
});

const reportsMissingFiles = Effect.gen(function* () {
  const root = yield* createTempDir;
  const env = new NodeExecutionEnv({ cwd: root });
  expect(yield* awaited(env.openTextLineReader("missing.txt", BACKGROUND_CONTEXT))).toMatchObject({
    error: { code: "not_found", path: joinPath(root, "missing.txt") },
    ok: false,
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
              MSA_CODING_AGENT: "true",
              MSA_NODE_ENV_PRESERVED_TEST: "preserved",
              MSA_SESSION_FILE: "/stale/parent.jsonl",
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
        { env: { [explicitKey]: "explicit" }, inheritEnv: false },
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

const writeFakeWslBash = Effect.fn("writeFakeWslBash")(function* (root: string) {
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
  return shellPath;
});

const asWindowsIn = <A, E>(root: string, effect: Effect.Effect<A, E>): Effect.Effect<A, E> => {
  const originalCwd = process.cwd();
  const originalPath = environmentVariable("PATH", true);
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  return Effect.sync(() => {
    process.chdir(root);
    vi.stubEnv("PATH", `${root}${pathDelimiter}${originalPath ?? ""}`);
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
  }).pipe(
    Effect.andThen(effect),
    Effect.ensuring(
      Effect.sync(() => {
        process.chdir(originalCwd);
        vi.unstubAllEnvs();
        if (platformDescriptor !== undefined) {
          Object.defineProperty(process, "platform", platformDescriptor);
        }
      }),
    ),
  );
};

const usesStdinCommand = Effect.gen(function* () {
  if (process.platform === "win32") return;
  const root = yield* createTempDir;
  const shellPath = yield* writeFakeWslBash(root);
  yield* asWindowsIn(
    root,
    Effect.gen(function* () {
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
    }),
  );
});

describe("NodeExecutionEnv shell", () => {
  it("uses stdin command transport for legacy WSL bash paths", () =>
    Effect.runPromise(usesStdinCommand));
});

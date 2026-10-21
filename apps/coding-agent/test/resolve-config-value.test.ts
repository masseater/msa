import { tmpdir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import resolveConfigValueModule from "../src/core/resolve-config-value.ts";
import shellModule from "../src/utils/shell.ts";

const { clearConfigValueCache, resolveConfigValue, resolveConfigValueUncached } =
  resolveConfigValueModule;

const {
  currentTimeMillis,
  joinPath,
  makeDirectory,
  pathExists,
  randomSuffixSync,
  readTextFile,
  removePath,
  runTest,
  writeTextFile,
} = testing;

let tempDir: string;

const resolvesLiteralsEnvironmentTemplatesAndEscapes = () => {
  vi.stubEnv("TEST_CONFIG_LEFT", "left");
  vi.stubEnv("TEST_CONFIG_RIGHT", "right");
  try {
    expect(resolveConfigValue("literal-key")).toBe("literal-key");
    expect(resolveConfigValue("$TEST_CONFIG_LEFT")).toBe("left");
    expect(resolveConfigValue("${TEST_CONFIG_LEFT}_$TEST_CONFIG_RIGHT")).toBe("left_right");
    expect(resolveConfigValue("$$TEST_CONFIG_LEFT")).toBe("$TEST_CONFIG_LEFT");
    expect(resolveConfigValue("$!literal-$TEST_CONFIG_RIGHT")).toBe("!literal-right");
  } finally {
    vi.stubEnv("TEST_CONFIG_LEFT", undefined);
    vi.stubEnv("TEST_CONFIG_RIGHT", undefined);
  }
};

const usesCredentialScopedEnvironmentBeforeProcessEnv = () => {
  vi.stubEnv("TEST_CONFIG_SCOPED", "process");
  try {
    expect(resolveConfigValue("$TEST_CONFIG_SCOPED", { TEST_CONFIG_SCOPED: "credential" })).toBe(
      "credential",
    );
  } finally {
    vi.stubEnv("TEST_CONFIG_SCOPED", undefined);
  }
};

const executesShellCommandsAndTrimsTheirOutput = () => {
  expect(resolveConfigValue("!echo '  spaced-key  '")).toBe("spaced-key");
  expect(resolveConfigValue("!printf 'line1\\nline2'")).toBe("line1\nline2");
  expect(resolveConfigValue("!echo 'hello world' | tr ' ' '-'")).toBe("hello-world");
};

const cachesSuccessfulAndFailedCommandsUntilExplicitly = () =>
  runTest(
    Effect.gen(function* () {
      const counterFile = joinPath(tempDir, "counter");
      yield* writeTextFile(counterFile, "0");
      const escapedPath = counterFile.replace(/\\/gu, "/").replace(/"/gu, '\\"');
      const success = `!sh -c 'count=$(cat "${escapedPath}"); echo $((count + 1)) > "${escapedPath}"; echo value'`;

      expect(resolveConfigValue(success)).toBe("value");
      expect(resolveConfigValue(success)).toBe("value");
      expect((yield* readTextFile(counterFile)).trim()).toBe("1");

      clearConfigValueCache();
      expect(resolveConfigValue(success)).toBe("value");
      expect((yield* readTextFile(counterFile)).trim()).toBe("2");

      const failure = `!sh -c 'count=$(cat "${escapedPath}"); echo $((count + 1)) > "${escapedPath}"; exit 1'`;
      expect(resolveConfigValue(failure)).toBeUndefined();
      expect(resolveConfigValue(failure)).toBeUndefined();
      expect((yield* readTextFile(counterFile)).trim()).toBe("3");
    }),
  );

const doesNotCacheEnvironmentValues = () => {
  vi.stubEnv("TEST_CONFIG_DYNAMIC", "first");
  try {
    expect(resolveConfigValue("$TEST_CONFIG_DYNAMIC")).toBe("first");
    vi.stubEnv("TEST_CONFIG_DYNAMIC", "second");
    expect(resolveConfigValue("$TEST_CONFIG_DYNAMIC")).toBe("second");
  } finally {
    vi.stubEnv("TEST_CONFIG_DYNAMIC", undefined);
  }
};

const uncachedResolutionExecutesACommandOnEvery = () =>
  runTest(
    Effect.gen(function* () {
      const counterFile = joinPath(tempDir, "uncached-counter");
      yield* writeTextFile(counterFile, "0");
      const escapedPath = counterFile.replace(/\\/gu, "/").replace(/"/gu, '\\"');
      const command = `!sh -c 'count=$(cat "${escapedPath}"); echo $((count + 1)) > "${escapedPath}"; echo value'`;
      expect(resolveConfigValueUncached(command)).toBe("value");
      expect(resolveConfigValueUncached(command)).toBe("value");
      expect((yield* readTextFile(counterFile)).trim()).toBe("2");
    }),
  );

const usesStdinWhenTheConfiguredWindowsShell = () => {
  if (process.platform === "win32") return;
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  vi.spyOn(shellModule, "getShellConfig").mockReturnValue({
    args: ["-s"],
    commandTransport: "stdin",
    shell: "/bin/bash",
  });
  try {
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
    const expansion = "${name}";
    expect(resolveConfigValueUncached(`!name='World'; echo "Hello, ${expansion}!"`)).toBe(
      "Hello, World!",
    );
  } finally {
    if (platformDescriptor !== undefined)
      Object.defineProperty(process, "platform", platformDescriptor);
  }
};

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = joinPath(tmpdir(), `msa-config-value-${currentTimeMillis()}-${randomSuffixSync()}`);
      yield* makeDirectory(tempDir);
      clearConfigValueCache();
    }),
  );

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      if (yield* pathExists(tempDir)) yield* removePath(tempDir);
      clearConfigValueCache();
      vi.restoreAllMocks();
    }),
  );

describe("resolveConfigValue", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  test(
    "resolves literals, environment templates, and escapes",
    resolvesLiteralsEnvironmentTemplatesAndEscapes,
  );

  test(
    "uses credential-scoped environment before process.env",
    usesCredentialScopedEnvironmentBeforeProcessEnv,
  );

  test("executes shell commands and trims their output", executesShellCommandsAndTrimsTheirOutput);

  test.each(["!exit 1", "!nonexistent-command-12345", "!printf ''"])(
    "returns undefined when command resolution fails: %s",
    (command) => {
      expect(resolveConfigValue(command)).toBeUndefined();
    },
  );
});

describe("resolveConfigValue", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  test(
    "caches successful and failed commands until explicitly cleared",
    cachesSuccessfulAndFailedCommandsUntilExplicitly,
  );

  test("does not cache environment values", doesNotCacheEnvironmentValues);

  test(
    "uncached resolution executes a command on every call",
    uncachedResolutionExecutesACommandOnEvery,
  );

  test(
    "uses stdin when the configured Windows shell requires it",
    usesStdinWhenTheConfiguredWindowsShell,
  );
});

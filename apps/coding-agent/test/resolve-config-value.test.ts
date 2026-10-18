import { tmpdir } from "node:os";

import {
  currentTimeMillis,
  randomSuffixSync,
  joinPath,
  runTest,
  pathExists,
  makeDirectory,
  readTextFile,
  removePath,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { deleteEnv, writeEnv } from "../src/core/process-env.ts";
import {
  clearConfigValueCache,
  resolveConfigValue,
  resolveConfigValueUncached,
} from "../src/core/resolve-config-value.ts";
import * as shellModule from "../src/utils/shell.ts";

describe("resolveConfigValue", () => {
  let tempDir: string;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = joinPath(
          tmpdir(),
          `msa-config-value-${currentTimeMillis()}-${randomSuffixSync()}`,
        );
        yield* makeDirectory(tempDir);
        clearConfigValueCache();
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        if (yield* pathExists(tempDir)) yield* removePath(tempDir);
        clearConfigValueCache();
        vi.restoreAllMocks();
      }),
    ),
  );

  test("resolves literals, environment templates, and escapes", () => {
    writeEnv("TEST_CONFIG_LEFT", "left");
    writeEnv("TEST_CONFIG_RIGHT", "right");
    try {
      expect(resolveConfigValue("literal-key")).toBe("literal-key");
      expect(resolveConfigValue("$TEST_CONFIG_LEFT")).toBe("left");
      expect(resolveConfigValue("${TEST_CONFIG_LEFT}_$TEST_CONFIG_RIGHT")).toBe("left_right");
      expect(resolveConfigValue("$$TEST_CONFIG_LEFT")).toBe("$TEST_CONFIG_LEFT");
      expect(resolveConfigValue("$!literal-$TEST_CONFIG_RIGHT")).toBe("!literal-right");
    } finally {
      deleteEnv("TEST_CONFIG_LEFT");
      deleteEnv("TEST_CONFIG_RIGHT");
    }
  });

  test("uses credential-scoped environment before process.env", () => {
    writeEnv("TEST_CONFIG_SCOPED", "process");
    try {
      expect(resolveConfigValue("$TEST_CONFIG_SCOPED", { TEST_CONFIG_SCOPED: "credential" })).toBe(
        "credential",
      );
    } finally {
      deleteEnv("TEST_CONFIG_SCOPED");
    }
  });

  test("executes shell commands and trims their output", () => {
    expect(resolveConfigValue("!echo '  spaced-key  '")).toBe("spaced-key");
    expect(resolveConfigValue("!printf 'line1\\nline2'")).toBe("line1\nline2");
    expect(resolveConfigValue("!echo 'hello world' | tr ' ' '-'")).toBe("hello-world");
  });

  test.each(["!exit 1", "!nonexistent-command-12345", "!printf ''"])(
    "returns undefined when command resolution fails: %s",
    (command) => {
      expect(resolveConfigValue(command)).toBeUndefined();
    },
  );

  test("caches successful and failed commands until explicitly cleared", () =>
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
    ));

  test("does not cache environment values", () => {
    writeEnv("TEST_CONFIG_DYNAMIC", "first");
    try {
      expect(resolveConfigValue("$TEST_CONFIG_DYNAMIC")).toBe("first");
      writeEnv("TEST_CONFIG_DYNAMIC", "second");
      expect(resolveConfigValue("$TEST_CONFIG_DYNAMIC")).toBe("second");
    } finally {
      deleteEnv("TEST_CONFIG_DYNAMIC");
    }
  });

  test("uncached resolution executes a command on every call", () =>
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
    ));

  test("uses stdin when the configured Windows shell requires it", () => {
    if (process.platform === "win32") return;
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    vi.spyOn(shellModule, "getShellConfig").mockReturnValue({
      shell: "/bin/bash",
      args: ["-s"],
      commandTransport: "stdin",
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
  });
});

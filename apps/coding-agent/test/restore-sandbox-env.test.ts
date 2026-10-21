import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import restoreSandboxEnvModule from "../src/bun/restore-sandbox-env.ts";
import platform from "../src/core/platform/index.ts";

const { envNames, envSnapshot, readEnv } = platform;
const { restoreSandboxEnv } = restoreSandboxEnvModule;
const { runTest } = testing;

const readText = vi.hoisted(() => vi.fn<(path: string) => Promise<string>>());

vi.mock("../src/core/platform/files.ts", (importOriginal) =>
  importOriginal<{ default: Record<string, unknown> }>().then((actual) => ({
    default: { ...actual.default, readText },
  })),
);

const stubVersions = (versions: Record<string, string>): (() => void) => {
  const originalVersions = Object.getOwnPropertyDescriptor(process, "versions");
  Object.defineProperty(process, "versions", {
    value: versions,
  });
  return () => {
    if (originalVersions !== undefined) {
      Object.defineProperty(process, "versions", originalVersions);
    }
  };
};

const emptyEnv = (): void => {
  for (const key of envNames()) vi.stubEnv(key, undefined);
  vi.stubEnv("FOO", undefined);
  vi.stubEnv("BAZ", undefined);
};

const restore = Effect.promise(() => restoreSandboxEnv());

const doesNothingWhenNotRunningUnderBun = () =>
  runTest(
    Effect.gen(function* () {
      const restoreVersions = stubVersions({ node: "20.0.0" });
      const envBefore = { ...envSnapshot() };
      yield* restore;
      expect(envSnapshot()).toEqual(envBefore);
      expect(readText).not.toHaveBeenCalled();
      restoreVersions();
    }),
  );

const doesNothingWhenProcessEnvAlreadyHas = () =>
  runTest(
    Effect.gen(function* () {
      const restoreVersions = stubVersions({ bun: "1.2.0", node: "20.0.0" });
      vi.stubEnv("RESTORE_SANDBOX_ENV_TEST", "1");
      const envBefore = { ...envSnapshot() };
      yield* restore;
      expect(envSnapshot()).toEqual(envBefore);
      expect(readText).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
      restoreVersions();
    }),
  );

const restoresEnvironmentFromProcSelfEnvironWhen = () =>
  runTest(
    Effect.gen(function* () {
      const restoreVersions = stubVersions({ bun: "1.2.0", node: "20.0.0" });
      emptyEnv();
      readText.mockResolvedValue("FOO=bar\0BAZ=qux\0");
      yield* restore;
      expect(readText).toHaveBeenCalledWith("/proc/self/environ");
      expect(readEnv("FOO")).toBe("bar");
      expect(readEnv("BAZ")).toBe("qux");
      vi.unstubAllEnvs();
      restoreVersions();
      readText.mockReset();
    }),
  );

describe("restoreSandboxEnv", () => {
  it("does nothing when not running under bun", doesNothingWhenNotRunningUnderBun);

  it("does nothing when process.env already has entries", doesNothingWhenProcessEnvAlreadyHas);

  it(
    "restores environment from /proc/self/environ when bun env is empty",
    restoresEnvironmentFromProcSelfEnvironWhen,
  );
});

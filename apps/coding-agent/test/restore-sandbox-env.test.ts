import { describe, expect, it, vi } from "vite-plus/test";

import { envNames, envSnapshot, readEnv } from "../src/core/process-env.ts";

const readFileSync = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync,
}));

const { restoreSandboxEnv } = await import("../src/bun/restore-sandbox-env.ts");

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

describe("restoreSandboxEnv", () => {
  it("does nothing when not running under bun", () => {
    const restoreVersions = stubVersions({ node: "20.0.0" });
    const envBefore = { ...envSnapshot() };

    restoreSandboxEnv();

    expect(envSnapshot()).toEqual(envBefore);

    restoreVersions();
  });

  it("does nothing when process.env already has entries", () => {
    const restoreVersions = stubVersions({ bun: "1.2.0", node: "20.0.0" });
    vi.stubEnv("RESTORE_SANDBOX_ENV_TEST", "1");
    const envBefore = { ...envSnapshot() };

    restoreSandboxEnv();

    expect(envSnapshot()).toEqual(envBefore);
    vi.unstubAllEnvs();

    restoreVersions();
  });

  it("restores environment from /proc/self/environ when bun env is empty", () => {
    const restoreVersions = stubVersions({ bun: "1.2.0", node: "20.0.0" });
    emptyEnv();

    readFileSync.mockReturnValue("FOO=bar\0BAZ=qux\0");

    restoreSandboxEnv();

    expect(readFileSync).toHaveBeenCalledWith("/proc/self/environ", "utf-8");
    expect(readEnv("FOO")).toBe("bar");
    expect(readEnv("BAZ")).toBe("qux");

    vi.unstubAllEnvs();
    restoreVersions();
    readFileSync.mockReset();
  });
});

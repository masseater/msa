import { describe, expect, it, vi } from "vite-plus/test";

import { deleteEnv, envNames, envSnapshot } from "../src/core/process-env.ts";

const readFileSync = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync,
}));

const { restoreSandboxEnv } = await import("../src/bun/restore-sandbox-env.ts");

describe("restoreSandboxEnv", () => {
  it("does nothing when not running under bun", () => {
    const originalVersions = Object.getOwnPropertyDescriptor(process, "versions");
    Object.defineProperty(process, "versions", {
      value: { node: "20.0.0" },
    });
    const envBefore = { ...envSnapshot() };

    restoreSandboxEnv();

    expect(process.env).toEqual(envBefore);

    if (originalVersions !== undefined) {
      Object.defineProperty(process, "versions", originalVersions);
    }
  });

  it("does nothing when process.env already has entries", () => {
    const originalVersions = Object.getOwnPropertyDescriptor(process, "versions");
    Object.defineProperty(process, "versions", {
      value: { bun: "1.2.0", node: "20.0.0" },
    });
    process.env["RESTORE_SANDBOX_ENV_TEST"] = "1";
    const envBefore = { ...envSnapshot() };

    restoreSandboxEnv();

    expect(process.env).toEqual(envBefore);
    deleteEnv("RESTORE_SANDBOX_ENV_TEST");

    if (originalVersions !== undefined) {
      Object.defineProperty(process, "versions", originalVersions);
    }
  });

  it("restores environment from /proc/self/environ when bun env is empty", () => {
    const originalVersions = Object.getOwnPropertyDescriptor(process, "versions");
    Object.defineProperty(process, "versions", {
      value: { bun: "1.2.0", node: "20.0.0" },
    });

    const envBackup = { ...envSnapshot() };
    for (const key of envNames()) {
      delete process.env[key];
    }

    readFileSync.mockReturnValue("FOO=bar\0BAZ=qux\0");

    restoreSandboxEnv();

    expect(readFileSync).toHaveBeenCalledWith("/proc/self/environ", "utf-8");
    expect(process.env["FOO"]).toBe("bar");
    expect(process.env["BAZ"]).toBe("qux");

    for (const key of envNames()) {
      delete process.env[key];
    }
    Object.assign(process.env, envBackup);

    if (originalVersions !== undefined) {
      Object.defineProperty(process, "versions", originalVersions);
    }
    readFileSync.mockReset();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { MockSpawnedProcess } from "./package-manager-support.ts";
import { Effect } from "effect";
import { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest } from "@msa/testing";
import { readEnv } from "../src/core/process-env.ts";

describe("DefaultPackageManager", () => {
  let tempDir: string;

  let agentDir: string;

  let settingsManager: SettingsManager;

  let packageManager: DefaultPackageManager;

  let previousOfflineEnv: string | undefined;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        previousOfflineEnv = readEnv("MSA_OFFLINE");
        vi.stubEnv("MSA_OFFLINE", undefined);
        tempDir = yield* makeTempDir("pm-test-");
        agentDir = joinPath(tempDir, "agent");
        yield* makeDirectory(agentDir);

        settingsManager = SettingsManager.inMemory();
        packageManager = new DefaultPackageManager({
          cwd: tempDir,
          agentDir,
          settingsManager,
        });
      }),
    ),
  );

  afterEach(() => {
    vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    return runTest(removePath(tempDir));
  });

  describe("offline mode and network timeouts", () => {
    it("should use npm view to fetch latest version", () => runTest(
Effect.gen(function* () {

      const runCommandCaptureSpy = vi
        .spyOn(packageManager as any, "runCommandCapture")
        .mockResolvedValue('"1.2.3"');

      const latest = (yield* awaited((packageManager as any).getLatestNpmVersion("example")));
      expect(latest).toBe("1.2.3");
      expect(runCommandCaptureSpy).toHaveBeenCalledTimes(1);
      expect(runCommandCaptureSpy).toHaveBeenCalledWith(
        "npm",
        ["view", "example", "version", "--json"],
        expect.objectContaining({ cwd: tempDir, timeoutMs: expect.any(Number) }),
      );
    
}),
));

    it("should use npmCommand argv for npm update checks", () => runTest(
Effect.gen(function* () {

      settingsManager = SettingsManager.inMemory({
        npmCommand: ["mise", "exec", "node@20", "--", "npm"],
      });
      packageManager = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
      });

      const runCommandCaptureSpy = vi
        .spyOn(packageManager as any, "runCommandCapture")
        .mockResolvedValue('"1.2.3"');

      const latest = (yield* awaited((packageManager as any).getLatestNpmVersion("@scope/pkg")));
      expect(latest).toBe("1.2.3");
      expect(runCommandCaptureSpy).toHaveBeenCalledWith(
        "mise",
        ["exec", "node@20", "--", "npm", "view", "@scope/pkg", "version", "--json"],
        expect.objectContaining({ cwd: tempDir }),
      );
    
}),
));

    it("should wait for close before resolving captured stdout", () => runTest(
Effect.gen(function* () {

      const managerWithInternals = packageManager as unknown as {
        spawnCaptureCommand(
          command: string,
          args: string[],
          options?: { cwd?: string; env?: Record<string, string> },
        ): MockSpawnedProcess;
        runCommandCapture(
          command: string,
          args: string[],
          options?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
        ): Promise<string>;
      };
      const child = new MockSpawnedProcess();
      vi.spyOn(managerWithInternals, "spawnCaptureCommand").mockReturnValue(child);

      let settled = false;
      const capturePromise = managerWithInternals
        .runCommandCapture("git", ["rev-parse", "HEAD"])
        .then((value) => {
          settled = true;
          return value;
        });

      child.emit("exit", 0, null);
      (yield* awaited(Promise.resolve()));
      expect(settled).toBe(false);

      child.stdout.write("abc123\n");
      child.stdout.end();
      child.emit("close", 0, null);

      (yield* awaited(expect(capturePromise).resolves.toBe("abc123")));
    
}),
));
  });
});

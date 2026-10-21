import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import commandRunner from "../src/core/package-manager/command-runner.ts";
import childProcess from "../src/utils/child-process.ts";
import MockSpawnedProcess from "./mock-spawned-process.ts";
import packageManagerFixture from "./package-manager-fixture.ts";

const { usePackageManagerFixture } = packageManagerFixture;
const { awaited, runTest } = testing;

const fixture = usePackageManagerFixture();

const shouldUseNpmViewToFetchLatest = () =>
  runTest(
    Effect.gen(function* () {
      const runCommandCaptureSpy = vi
        .spyOn(commandRunner, "runCommandCapture")
        .mockResolvedValue('"1.2.3"');

      const latest = yield* awaited(
        fixture.packageManager.npm.updates.getLatestNpmVersion("example"),
      );
      expect(latest).toBe("1.2.3");
      expect(runCommandCaptureSpy).toHaveBeenCalledTimes(1);
      expect(runCommandCaptureSpy).toHaveBeenCalledWith(
        "npm",
        ["view", "example", "version", "--json"],
        expect.objectContaining({ cwd: fixture.tempDir, timeoutMs: expect.any(Number) }),
      );
    }),
  );

const shouldUseNpmcommandArgvForNpmUpdate = () =>
  runTest(
    Effect.gen(function* () {
      fixture.useSettings({ npmCommand: ["mise", "exec", "node@20", "--", "npm"] });

      const runCommandCaptureSpy = vi
        .spyOn(commandRunner, "runCommandCapture")
        .mockResolvedValue('"1.2.3"');

      const latest = yield* awaited(
        fixture.packageManager.npm.updates.getLatestNpmVersion("@scope/pkg"),
      );
      expect(latest).toBe("1.2.3");
      expect(runCommandCaptureSpy).toHaveBeenCalledWith(
        "mise",
        ["exec", "node@20", "--", "npm", "view", "@scope/pkg", "version", "--json"],
        expect.objectContaining({ cwd: fixture.tempDir }),
      );
    }),
  );

const shouldWaitForCloseBeforeResolvingCaptured = () =>
  runTest(
    Effect.gen(function* () {
      const child = new MockSpawnedProcess();
      vi.spyOn(childProcess, "spawnProcess").mockReturnValue(
        child as unknown as ReturnType<typeof childProcess.spawnProcess>,
      );

      let settled = false;
      const capturePromise = commandRunner
        .runCommandCapture("git", ["rev-parse", "HEAD"])
        .then((value) => {
          settled = true;
          return value;
        });

      child.emit("exit", 0, null);
      yield* awaited(Promise.resolve());
      expect(settled).toBe(false);

      child.stdout.write("abc123\n");
      child.stdout.end();
      child.emit("close", 0, null);

      yield* awaited(expect(capturePromise).resolves.toBe("abc123"));
    }),
  );

describe("DefaultPackageManager", () => {
  describe("offline mode and network timeouts", () => {
    it("should use npm view to fetch latest version", shouldUseNpmViewToFetchLatest);

    it("should use npmCommand argv for npm update checks", shouldUseNpmcommandArgvForNpmUpdate);

    it(
      "should wait for close before resolving captured stdout",
      shouldWaitForCloseBeforeResolvingCaptured,
    );
  });
});

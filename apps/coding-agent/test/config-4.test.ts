import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { detectInstallChange } from "../src/config.ts";
import { readEnv } from "../src/core/process-env.ts";

const { joinPath, makeDirectory, makeTempDir, removePath, runTest, writeJsonFile } = testing;

const execPathDescriptor = Object.getOwnPropertyDescriptor(process, "execPath");
const originalPath = readEnv("PATH");
const originalMsaPackageDir = readEnv("MSA_PACKAGE_DIR");
const originalArgv1 = process.argv[1];
let tempDir: string | undefined;

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      vi.unstubAllEnvs();
      if (execPathDescriptor !== undefined) {
        Object.defineProperty(process, "execPath", execPathDescriptor);
      }
      if (originalPath === undefined) vi.stubEnv("PATH", undefined);
      else vi.stubEnv("PATH", originalPath);
      if (originalMsaPackageDir === undefined) vi.stubEnv("MSA_PACKAGE_DIR", undefined);
      else vi.stubEnv("MSA_PACKAGE_DIR", originalMsaPackageDir);
      if (originalArgv1 === undefined) process.argv.splice(1, 1);
      else process.argv[1] = originalArgv1;
      if (tempDir !== undefined && tempDir.length > 0) {
        yield* removePath(tempDir);
        tempDir = undefined;
      }
    }),
  ),
);

const reportsARemovedInstallInsteadOfReading = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = yield* makeTempDir("msa-install-change-");
      const installDir = joinPath(tempDir, "global", "hash");
      yield* makeDirectory(installDir);
      yield* writeJsonFile(joinPath(tempDir, "package.json"), { version: "0.0.1" });
      yield* removePath(installDir);
      expect(detectInstallChange(joinPath(installDir, "package.json"))).toEqual({
        kind: "removed",
      });
    }),
  );

describe("detectInstallChange", () => {
  test(
    "reports a removed install instead of reading a package.json further up",
    reportsARemovedInstallInsteadOfReading,
  );
});

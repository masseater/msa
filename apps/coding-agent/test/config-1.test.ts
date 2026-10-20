import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { findNodePackageDir } from "../src/config.ts";
import { readEnv } from "../src/core/process-env.ts";

const { joinPath, makeDirectory, makeTempDir, removePath, runTest, writeTextFile } = testing;

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

const skipsBinaryMetadataCopiedIntoDist = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = yield* makeTempDir("msa-package-dir-");
      const distDir = joinPath(tempDir, "dist");
      const bundleDir = joinPath(distDir, "bundle");
      yield* makeDirectory(bundleDir);
      yield* writeTextFile(joinPath(tempDir, "package.json"), "{}");
      yield* writeTextFile(joinPath(distDir, "package.json"), "{}");

      expect(findNodePackageDir(bundleDir)).toBe(tempDir);
    }),
  );

describe("findNodePackageDir", () => {
  test("skips binary metadata copied into dist", skipsBinaryMetadataCopiedIntoDist);
});

import { tmpdir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import platform from "../src/core/platform/index.ts";
import ProjectTrustStore from "../src/core/project-trust-store.ts";
import trustManager from "../src/core/trust-manager.ts";

const { hasTrustRequiringProjectResources } = trustManager;
const { readEnv } = platform;

const {
  currentTimeMillis,
  joinPath,
  makeDirectory,
  randomSuffixSync,
  removePath,
  runTest,
  writeTextFile,
} = testing;

let tempDir: string;

let agentDir: string;

let cwd: string;

const storesDecisionsAndInheritsFromParentDirectories = () =>
  runTest(
    Effect.gen(function* () {
      const store = new ProjectTrustStore(agentDir);
      const parentDir = joinPath(tempDir, "trusted-parent");
      const childDir = joinPath(parentDir, "project");
      yield* makeDirectory(childDir);

      expect(yield* Effect.promise(() => store.get(childDir))).toBeNull();
      yield* Effect.promise(() => store.set(parentDir, true));
      expect(yield* Effect.promise(() => store.get(childDir))).toBe(true);
      yield* Effect.promise(() => store.set(childDir, false));
      expect(yield* Effect.promise(() => store.get(childDir))).toBe(false);
      yield* Effect.promise(() => store.set(childDir, null));
      expect(yield* Effect.promise(() => store.get(childDir))).toBe(true);
    }),
  );

const detectsTrustRequiringProjectResources = () =>
  runTest(
    Effect.gen(function* () {
      const originalHome = readEnv("HOME");
      vi.stubEnv("HOME", tempDir);
      try {
        yield* makeDirectory(joinPath(tempDir, ".msa", "agent"));
        yield* makeDirectory(joinPath(tempDir, ".agents", "skills"));
        expect(yield* Effect.promise(() => hasTrustRequiringProjectResources(tempDir))).toBe(false);
        expect(yield* Effect.promise(() => hasTrustRequiringProjectResources(cwd))).toBe(false);

        yield* writeTextFile(joinPath(tempDir, ".msa", "settings.json"), "{}");
        expect(yield* Effect.promise(() => hasTrustRequiringProjectResources(tempDir))).toBe(true);
        yield* removePath(joinPath(tempDir, ".msa", "settings.json"));

        yield* makeDirectory(joinPath(cwd, ".msa"));
        yield* writeTextFile(joinPath(cwd, ".msa", "settings.json"), "{}");
        expect(yield* Effect.promise(() => hasTrustRequiringProjectResources(cwd))).toBe(true);

        yield* removePath(joinPath(cwd, ".msa"));
        yield* makeDirectory(joinPath(cwd, ".agents", "skills"));
        expect(yield* Effect.promise(() => hasTrustRequiringProjectResources(cwd))).toBe(true);
      } finally {
        if (originalHome === undefined) {
          vi.stubEnv("HOME", undefined);
        } else {
          vi.stubEnv("HOME", originalHome);
        }
      }
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = joinPath(tmpdir(), `trust-test-${currentTimeMillis()}-${randomSuffixSync()}`);
      agentDir = joinPath(tempDir, "agent");
      cwd = joinPath(tempDir, "project");
      yield* makeDirectory(agentDir);
      yield* makeDirectory(cwd);
    }),
  );

describe("ProjectTrustStore", () => {
  beforeEach(beforeEachHook);

  afterEach(() => runTest(removePath(tempDir)));

  it(
    "stores decisions and inherits from parent directories",
    storesDecisionsAndInheritsFromParentDirectories,
  );

  it("detects trust-requiring project resources", detectsTrustRequiringProjectResources);
});

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  currentTimeMillis,
  randomSuffixSync,
  joinPath,
  runTest,
  makeDirectory,
  removePath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { deleteEnv, readEnv, writeEnv } from "../src/core/process-env.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../src/core/trust-manager.ts";

describe("ProjectTrustStore", () => {
  let tempDir: string;
  let agentDir: string;
  let cwd: string;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = joinPath(tmpdir(), `trust-test-${currentTimeMillis()}-${randomSuffixSync()}`);
        agentDir = joinPath(tempDir, "agent");
        cwd = joinPath(tempDir, "project");
        yield* makeDirectory(agentDir);
        yield* makeDirectory(cwd);
      }),
    ),
  );

  afterEach(() => runTest(removePath(tempDir)));

  it("stores decisions and inherits from parent directories", () => {
    const store = new ProjectTrustStore(agentDir);
    const parentDir = joinPath(tempDir, "trusted-parent");
    const childDir = joinPath(parentDir, "project");
    mkdirSync(childDir, { recursive: true });

    expect(store.get(childDir)).toBeNull();
    store.set(parentDir, true);
    expect(store.get(childDir)).toBe(true);
    store.set(childDir, false);
    expect(store.get(childDir)).toBe(false);
    store.set(childDir, null);
    expect(store.get(childDir)).toBe(true);
  });

  it("detects trust-requiring project resources", () => {
    const originalHome = readEnv("HOME");
    writeEnv("HOME", tempDir);
    try {
      mkdirSync(joinPath(tempDir, ".msa", "agent"), { recursive: true });
      mkdirSync(joinPath(tempDir, ".agents", "skills"), { recursive: true });
      expect(hasTrustRequiringProjectResources(tempDir)).toBe(false);
      expect(hasTrustRequiringProjectResources(cwd)).toBe(false);

      writeFileSync(joinPath(tempDir, ".msa", "settings.json"), "{}");
      expect(hasTrustRequiringProjectResources(tempDir)).toBe(true);
      rmSync(joinPath(tempDir, ".msa", "settings.json"), { force: true });

      mkdirSync(joinPath(cwd, ".msa"), { recursive: true });
      writeFileSync(joinPath(cwd, ".msa", "settings.json"), "{}");
      expect(hasTrustRequiringProjectResources(cwd)).toBe(true);

      rmSync(joinPath(cwd, ".msa"), { recursive: true, force: true });
      mkdirSync(joinPath(cwd, ".agents", "skills"), { recursive: true });
      expect(hasTrustRequiringProjectResources(cwd)).toBe(true);
    } finally {
      if (originalHome === undefined) {
        deleteEnv("HOME");
      } else {
        writeEnv("HOME", originalHome);
      }
    }
  });
});

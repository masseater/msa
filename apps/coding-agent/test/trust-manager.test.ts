import { tmpdir } from "node:os";

import {
  currentTimeMillis,
  randomSuffixSync,
  joinPath,
  runTest,
  makeDirectory,
  removePath,
  writeTextFile,
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

  it("stores decisions and inherits from parent directories", () =>
    runTest(
      Effect.gen(function* () {
        const store = new ProjectTrustStore(agentDir);
        const parentDir = joinPath(tempDir, "trusted-parent");
        const childDir = joinPath(parentDir, "project");
        yield* makeDirectory(childDir);

        expect(store.get(childDir)).toBeNull();
        store.set(parentDir, true);
        expect(store.get(childDir)).toBe(true);
        store.set(childDir, false);
        expect(store.get(childDir)).toBe(false);
        store.set(childDir, null);
        expect(store.get(childDir)).toBe(true);
      }),
    ));

  it("detects trust-requiring project resources", () =>
    runTest(
      Effect.gen(function* () {
        const originalHome = readEnv("HOME");
        writeEnv("HOME", tempDir);
        try {
          yield* makeDirectory(joinPath(tempDir, ".msa", "agent"));
          yield* makeDirectory(joinPath(tempDir, ".agents", "skills"));
          expect(hasTrustRequiringProjectResources(tempDir)).toBe(false);
          expect(hasTrustRequiringProjectResources(cwd)).toBe(false);

          yield* writeTextFile(joinPath(tempDir, ".msa", "settings.json"), "{}");
          expect(hasTrustRequiringProjectResources(tempDir)).toBe(true);
          yield* removePath(joinPath(tempDir, ".msa", "settings.json"));

          yield* makeDirectory(joinPath(cwd, ".msa"));
          yield* writeTextFile(joinPath(cwd, ".msa", "settings.json"), "{}");
          expect(hasTrustRequiringProjectResources(cwd)).toBe(true);

          yield* removePath(joinPath(cwd, ".msa"));
          yield* makeDirectory(joinPath(cwd, ".agents", "skills"));
          expect(hasTrustRequiringProjectResources(cwd)).toBe(true);
        } finally {
          if (originalHome === undefined) {
            deleteEnv("HOME");
          } else {
            writeEnv("HOME", originalHome);
          }
        }
      }),
    ));
});

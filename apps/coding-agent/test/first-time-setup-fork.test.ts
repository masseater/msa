import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../src/config.ts", (importOriginal) =>
  testing.runTest(
    Effect.gen(function* () {
      const actual = yield* testing.awaited(importOriginal());
      const { default: config } = actual as { default: Record<string, unknown> };
      return yield* testing.awaited({
        default: { ...config, PACKAGE_NAME: "@example/msa-coding-agent" },
      });
    }),
  ),
);

import testing from "@msa/testing";
import { Effect } from "effect";

import startupUi from "../src/cli/startup-ui.ts";
import processEnv from "../src/core/process-env.ts";

const { deleteEnv, readEnv, writeEnv } = processEnv;
const { shouldRunFirstTimeSetup } = startupUi;

const { joinPath, makeTempDir, removePath, runTest } = testing;

const originalMsaExperimental = readEnv("MSA_EXPERIMENTAL");

let tempDir: string;

let settingsPath: string;

const returnsFalseForAForkedPackage = () => {
  expect(shouldRunFirstTimeSetup(settingsPath)).toBe(false);
};

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = yield* makeTempDir("msa-first-time-setup-fork-");
      settingsPath = joinPath(tempDir, "settings.json");
      writeEnv("MSA_EXPERIMENTAL", "1");
    }),
  );

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      yield* removePath(tempDir);
      if (originalMsaExperimental === undefined) {
        deleteEnv("MSA_EXPERIMENTAL");
      } else {
        writeEnv("MSA_EXPERIMENTAL", originalMsaExperimental);
      }
    }),
  );

describe("shouldRunFirstTimeSetup in forked distributions", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  it("returns false for a forked package", returnsFalseForAForkedPackage);
});

import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  collectSettingsDiagnostics,
  deduplicateDiagnostics,
} from "../src/core/settings-diagnostics.ts";
import { SettingsManager, type SettingsStorage } from "../src/core/settings-manager.ts";

const { joinPath, makeDirectory, makeTempDir, removePath, runTest, writeTextFile } = testing;

const includesTheSettingsFilePathForFile = () =>
  runTest(
    Effect.gen(function* () {
      const tempDir = yield* makeTempDir("msa-settings-diagnostics-");
      const agentDir = joinPath(tempDir, "agent");
      const settingsPath = joinPath(agentDir, "settings.json");
      yield* makeDirectory(agentDir);
      yield* writeTextFile(settingsPath, "{");

      yield* Effect.sync(() => {
        const diagnostics = collectSettingsDiagnostics(SettingsManager.create(tempDir, agentDir));

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]?.type).toBe("warning");
        expect(diagnostics[0]?.message).toContain(`Invalid settings file ${settingsPath}:`);
      }).pipe(Effect.ensuring(removePath(tempDir)));
    }),
  );

const fallsBackToTheSettingsScopeFor = () => {
  const storage: SettingsStorage = {
    withLock(scope, fn) {
      if (scope === "global") throw new Error("backend failed");
      fn(undefined);
    },
  };
  const diagnostics = collectSettingsDiagnostics(SettingsManager.fromStorage(storage));

  expect(diagnostics).toEqual([
    { message: "Invalid global settings: backend failed", type: "warning" },
  ]);
};

const deduplicatesDiagnosticsByTypeAndMessage = () => {
  const warning = {
    message: "Invalid settings file /tmp/settings.json",
    type: "warning" as const,
  };

  expect(deduplicateDiagnostics([warning, warning, { ...warning, type: "error" }])).toEqual([
    warning,
    { ...warning, type: "error" },
  ]);
};

describe("settings diagnostics", () => {
  it("includes the settings file path for file-backed storage", includesTheSettingsFilePathForFile);

  it(
    "falls back to the settings scope for storage without file paths",
    fallsBackToTheSettingsScopeFor,
  );

  it("deduplicates diagnostics by type and message", deduplicatesDiagnosticsByTypeAndMessage);
});

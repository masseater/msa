import {
  joinPath,
  makeDirectory,
  makeTempDir,
  removePath,
  runTest,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  collectSettingsDiagnostics,
  deduplicateDiagnostics,
} from "../src/core/settings-diagnostics.ts";
import { SettingsManager, type SettingsStorage } from "../src/core/settings-manager.ts";

describe("settings diagnostics", () => {
  it("includes the settings file path for file-backed storage", () =>
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
    ));

  it("falls back to the settings scope for storage without file paths", () => {
    const storage: SettingsStorage = {
      withLock(scope, fn) {
        if (scope === "global") throw new Error("backend failed");
        fn(undefined);
      },
    };
    const diagnostics = collectSettingsDiagnostics(SettingsManager.fromStorage(storage));

    expect(diagnostics).toEqual([
      { type: "warning", message: "Invalid global settings: backend failed" },
    ]);
  });

  it("deduplicates diagnostics by type and message", () => {
    const warning = {
      type: "warning" as const,
      message: "Invalid settings file /tmp/settings.json",
    };

    expect(deduplicateDiagnostics([warning, warning, { ...warning, type: "error" }])).toEqual([
      warning,
      { ...warning, type: "error" },
    ]);
  });
});

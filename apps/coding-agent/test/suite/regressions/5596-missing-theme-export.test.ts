import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { SessionManager } from "../../../src/core/session-manager.ts";
import tuiKit from "../../tui-kit.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { fauxAssistantMessage } = ai;

const { awaited, joinPath, makeTempDir, pathExists, removeDirs, runTest } = testing;

const { initTheme } = tuiKit;

const { createHarness } = harnessModule;

const harnesses: harnessTypes.Harness[] = [];

const sessionDirs: string[] = [];

const exportsWithTheActiveFallbackTheme = Effect.gen(function* () {
  const sessionDir = yield* makeTempDir("msa-5596-");
  sessionDirs.push(sessionDir);
  const harness = yield* awaited(
    createHarness({
      sessionManager: SessionManager.create(sessionDir, joinPath(sessionDir, "sessions")),
      settings: { theme: "missing-theme" },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("hello")]);
  yield* awaited(harness.session.prompt("hi"));
  initTheme(harness.settingsManager.getTheme());
  const outputPath = joinPath(sessionDir, "export.html");
  yield* awaited(expect(harness.session.exportToHtml(outputPath)).resolves.toBe(outputPath));
  expect(yield* pathExists(outputPath)).toBe(true);
  expect(harness.settingsManager.getTheme()).toBe("missing-theme");
});

const afterEachHook = () => {
  while (harnesses.length > 0) harnesses.pop()?.cleanup();
  initTheme("dark");
  return runTest(removeDirs(sessionDirs.splice(0)));
};

describe("regression #5596: missing configured theme export", () => {
  afterEach(afterEachHook);
  it("exports with the active fallback theme when the configured theme is missing", () =>
    runTest(exportsWithTheActiveFallbackTheme));
});

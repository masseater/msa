import { homedir } from "node:os";

import { awaited, joinPath, runTest, writeJsonFile } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { ORCHESTRATOR_TOOL_NAMES } from "../src/core/orchestrator/tool-names.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { readSettings, removeSettingsDirs, withSettings } from "./settings-manager-support.ts";

afterEach(() => runTest(removeSettingsDirs));

describe("SettingsManager", () => {
  describe("shellCommandPrefix", () => {
    it("should load shellCommandPrefix from settings", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, {
              shellCommandPrefix: "shopt -s expand_aliases",
            });

            const manager = openManager();

            expect(manager.getShellCommandPrefix()).toBe("shopt -s expand_aliases");
          }),
        ),
      ));

    it("should return undefined when shellCommandPrefix is not set", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { theme: "dark" });

            const manager = openManager();

            expect(manager.getShellCommandPrefix()).toBeUndefined();
          }),
        ),
      ));

    it("should preserve shellCommandPrefix when saving unrelated settings", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, {
              shellCommandPrefix: "shopt -s expand_aliases",
            });

            const manager = openManager();
            manager.setTheme("light");
            yield* awaited(manager.flush());

            const savedSettings = yield* readSettings(settingsPath);
            expect(savedSettings.shellCommandPrefix).toBe("shopt -s expand_aliases");
            expect(savedSettings.theme).toBe("light");
          }),
        ),
      ));
  });

  describe("defaultTools", () => {
    it("loads global defaults and lets project settings replace them", () =>
      runTest(
        withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { defaultTools: ["read", "bash"] });

            expect(openManager().getDefaultTools()).toEqual(["read", "bash"]);

            yield* writeJsonFile(projectSettingsPath, { defaultTools: ["grep"] });

            expect(openManager().getDefaultTools()).toEqual(["grep"]);
          }),
        ),
      ));

    it("preserves an empty tool list", () => {
      expect(SettingsManager.inMemory({ defaultTools: [] }).getDefaultTools()).toEqual([]);
      expect(SettingsManager.inMemory().getDefaultTools()).toBeUndefined();
    });

    it("applies +name and -name to the default selection", () => {
      expect(
        SettingsManager.inMemory({ defaultTools: ["+codemode", "-write"] }).getDefaultTools(),
      ).toEqual([
        "read",
        "bash",
        "edit",
        "memory",
        "pr_watch",
        "model_policy",
        "model_upgrade",
        ...ORCHESTRATOR_TOOL_NAMES,
        "web_search",
        "web_fetch",
        "codemode",
      ]);
      expect(
        SettingsManager.inMemory({ defaultTools: ["read", "+grep", "+read"] }).getDefaultTools(),
      ).toEqual(["read", "grep"]);
    });

    it("layers project modifiers on top of the global selection", () =>
      runTest(
        withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, {
              defaultTools: ["read", "bash", "+codemode"],
            });
            yield* writeJsonFile(projectSettingsPath, {
              defaultTools: ["-codemode", "+tool_search"],
            });

            const manager = openManager();
            expect(manager.getDefaultTools()).toEqual(["read", "bash", "tool_search"]);

            manager.applyOverrides({ defaultTools: ["+codemode"] });
            expect(manager.getDefaultTools()).toEqual(["read", "bash", "tool_search", "codemode"]);
          }),
        ),
      ));

    it("applies project modifiers to the built-in defaults without a global setting", () =>
      runTest(
        withSettings(({ projectSettingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(projectSettingsPath, { defaultTools: ["+codemode"] });

            expect(openManager().getDefaultTools()).toEqual([
              "read",
              "bash",
              "edit",
              "write",
              "memory",
              "pr_watch",
              "model_policy",
              "model_upgrade",
              ...ORCHESTRATOR_TOOL_NAMES,
              "web_search",
              "web_fetch",
              "codemode",
            ]);
          }),
        ),
      ));
  });

  describe("getSessionDir", () => {
    it("should return undefined when not set", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { theme: "dark" });
            const manager = openManager();
            expect(manager.getSessionDir()).toBeUndefined();
          }),
        ),
      ));

    it("should return global sessionDir", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { sessionDir: "/tmp/sessions" });
            const manager = openManager();
            expect(manager.getSessionDir()).toBe("/tmp/sessions");
          }),
        ),
      ));

    it("should return project sessionDir, overriding global", () =>
      runTest(
        withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { sessionDir: "/global/sessions" });
            yield* writeJsonFile(projectSettingsPath, { sessionDir: "./sessions" });
            const manager = openManager();
            expect(manager.getSessionDir()).toBe("./sessions");
          }),
        ),
      ));

    it("should expand ~ in sessionDir", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { sessionDir: "~/sessions" });
            const manager = openManager();
            expect(manager.getSessionDir()).toBe(joinPath(homedir(), "sessions"));
          }),
        ),
      ));
  });

  describe("getShellPath", () => {
    it("should return undefined when not set", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { theme: "dark" });
            const manager = openManager();
            expect(manager.getShellPath()).toBeUndefined();
          }),
        ),
      ));

    it("should return an absolute shellPath unchanged", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { shellPath: "/bin/zsh" });
            const manager = openManager();
            expect(manager.getShellPath()).toBe("/bin/zsh");
          }),
        ),
      ));

    it("should expand ~ in shellPath", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, {
              shellPath: "~/.local/bin/agent-shell-sandbox",
            });
            const manager = openManager();
            expect(manager.getShellPath()).toBe(
              joinPath(homedir(), ".local/bin/agent-shell-sandbox"),
            );
          }),
        ),
      ));

    it("should expand a bare ~ in shellPath", () =>
      runTest(
        withSettings(({ settingsPath, openManager }) =>
          Effect.gen(function* () {
            yield* writeJsonFile(settingsPath, { shellPath: "~" });
            const manager = openManager();
            expect(manager.getShellPath()).toBe(homedir());
          }),
        ),
      ));
  });
});

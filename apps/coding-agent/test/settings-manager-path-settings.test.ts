import { homedir } from "node:os";

import testing from "@msa/testing";
import { afterEach, describe } from "vite-plus/test";

import settingsManagerSupport from "./settings-manager-support.ts";

const { removeSettingsDirs, settingsRead } = settingsManagerSupport;

const { joinPath, runTest } = testing;

afterEach(() => runTest(removeSettingsDirs));

describe("SettingsManager", () => {
  describe("getSessionDir", () => {
    settingsRead(
      (manager) => manager.session.getSessionDir(),
      [
        ["should return undefined when not set", { global: { theme: "dark" } }, undefined],
        [
          "should return global sessionDir",
          { global: { sessionDir: "/tmp/sessions" } },
          "/tmp/sessions",
        ],
        [
          "should return project sessionDir, overriding global",
          { global: { sessionDir: "/global/sessions" }, project: { sessionDir: "./sessions" } },
          "./sessions",
        ],
        [
          "should expand ~ in sessionDir",
          { global: { sessionDir: "~/sessions" } },
          joinPath(homedir(), "sessions"),
        ],
      ],
    );
  });

  describe("getShellPath", () => {
    settingsRead(
      (manager) => manager.resources.getShellPath(),
      [
        ["should return undefined when not set", { global: { theme: "dark" } }, undefined],
        [
          "should return an absolute shellPath unchanged",
          { global: { shellPath: "/bin/zsh" } },
          "/bin/zsh",
        ],
        [
          "should expand ~ in shellPath",
          { global: { shellPath: "~/.local/bin/agent-shell-sandbox" } },
          joinPath(homedir(), ".local/bin/agent-shell-sandbox"),
        ],
        ["should expand a bare ~ in shellPath", { global: { shellPath: "~" } }, homedir()],
      ],
    );
  });
});

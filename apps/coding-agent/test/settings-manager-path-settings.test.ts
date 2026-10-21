import { homedir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import settingsManagerSupport from "./settings-manager-support.ts";

const { removeSettingsDirs, withSettings } = settingsManagerSupport;

const { joinPath, runTest, writeJsonFile } = testing;

afterEach(() => runTest(removeSettingsDirs));

const shouldReturnUndefinedWhenNotSet = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { theme: "dark" });
        const manager = openManager();
        expect(manager.session.getSessionDir()).toBeUndefined();
      }),
    ),
  );

const shouldReturnGlobalSessiondir = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { sessionDir: "/tmp/sessions" });
        const manager = openManager();
        expect(manager.session.getSessionDir()).toBe("/tmp/sessions");
      }),
    ),
  );

const shouldReturnProjectSessiondirOverridingGlobal = () =>
  runTest(
    withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { sessionDir: "/global/sessions" });
        yield* writeJsonFile(projectSettingsPath, { sessionDir: "./sessions" });
        const manager = openManager();
        expect(manager.session.getSessionDir()).toBe("./sessions");
      }),
    ),
  );

const shouldExpandInSessiondir = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { sessionDir: "~/sessions" });
        const manager = openManager();
        expect(manager.session.getSessionDir()).toBe(joinPath(homedir(), "sessions"));
      }),
    ),
  );

const shouldReturnUndefinedWhenNotSet2 = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { theme: "dark" });
        const manager = openManager();
        expect(manager.resources.getShellPath()).toBeUndefined();
      }),
    ),
  );

const shouldReturnAnAbsoluteShellpathUnchanged = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { shellPath: "/bin/zsh" });
        const manager = openManager();
        expect(manager.resources.getShellPath()).toBe("/bin/zsh");
      }),
    ),
  );

const shouldExpandInShellpath = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, {
          shellPath: "~/.local/bin/agent-shell-sandbox",
        });
        const manager = openManager();
        expect(manager.resources.getShellPath()).toBe(
          joinPath(homedir(), ".local/bin/agent-shell-sandbox"),
        );
      }),
    ),
  );

const shouldExpandABareInShellpath = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { shellPath: "~" });
        const manager = openManager();
        expect(manager.resources.getShellPath()).toBe(homedir());
      }),
    ),
  );

describe("SettingsManager", () => {
  describe("getSessionDir", () => {
    it("should return undefined when not set", shouldReturnUndefinedWhenNotSet);

    it("should return global sessionDir", shouldReturnGlobalSessiondir);

    it(
      "should return project sessionDir, overriding global",
      shouldReturnProjectSessiondirOverridingGlobal,
    );

    it("should expand ~ in sessionDir", shouldExpandInSessiondir);
  });

  describe("getShellPath", () => {
    it("should return undefined when not set", shouldReturnUndefinedWhenNotSet2);

    it("should return an absolute shellPath unchanged", shouldReturnAnAbsoluteShellpathUnchanged);

    it("should expand ~ in shellPath", shouldExpandInShellpath);

    it("should expand a bare ~ in shellPath", shouldExpandABareInShellpath);
  });
});

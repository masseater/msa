import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import InMemorySettingsStorage from "../src/core/in-memory-settings-storage.ts";
import codingAgent from "../src/index.ts";
import mainModule from "../src/main.ts";
import ConfigSelectorComponent from "../src/modes/interactive/components/config-selector.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import packageCommandPathsSupport from "./package-command-paths-support.ts";
import type packageCommandPathsSupportTypes from "./package-command-paths-support.types.ts";

const { DefaultPackageManager, SettingsManager } = codingAgent;

const { initTheme } = themeModule;
const { main } = mainModule;

const { paths, setupPackageTest, teardownPackageTest, toJsonTextSync } = packageCommandPathsSupport;

const { awaited, fromJsonText, joinPath, readTextFile, runTest, toJsonText, writeTextFile } =
  testing;

let state: packageCommandPathsSupportTypes.PackageTestState;

let tempDir = "";

let agentDir = "";

let projectDir = "";

const assignState = (
  next: packageCommandPathsSupportTypes.PackageTestState,
): packageCommandPathsSupportTypes.PackageTestState => {
  state = next;
  tempDir = next.tempDir;
  agentDir = next.agentDir;
  projectDir = next.projectDir;
  return next;
};

const cyclesProjectPackageOverridesInConfigLocal = () =>
  runTest(
    Effect.sync(() => {
      const storage = new InMemorySettingsStorage();
      storage.withLock("global", () => toJsonTextSync({ packages: ["npm:msa-tools"] }));
      const settingsManager = SettingsManager.fromStorage(storage, { projectTrusted: true });
      const resolvedPaths = paths.extension(joinPath(tempDir, "pkg"), "npm:msa-tools", "user", [
        "bar.ts",
      ]);
      const selector = new ConfigSelectorComponent(
        { global: resolvedPaths, project: resolvedPaths },
        settingsManager,
        projectDir,
        agentDir,
        () => {},
        () => {},
        () => {},
        24,
        "project",
      );

      selector.getResourceList().handleInput(" ");
      expect(settingsManager.getProjectSettings().packages).toEqual([
        { autoload: false, extensions: ["-extensions/bar.ts"], source: "npm:msa-tools" },
      ]);

      selector.getResourceList().handleInput(" ");
      expect(settingsManager.getProjectSettings().packages).toEqual([
        { autoload: false, extensions: ["+extensions/bar.ts"], source: "npm:msa-tools" },
      ]);

      selector.getResourceList().handleInput(" ");
      expect(settingsManager.getProjectSettings().packages).toEqual([]);
    }),
  );

const togglesBuiltInExtensionsInConfigGlobal = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("HOME", tempDir);
      const settingsManager = SettingsManager.fromStorage(new InMemorySettingsStorage(), {
        projectTrusted: true,
      });
      const resolvedPaths = yield* awaited(
        new DefaultPackageManager({
          agentDir,
          builtinExtensions: ["llama.cpp", "mcp"],
          cwd: projectDir,
          settingsManager,
        }).resolve(),
      );
      const selector = new ConfigSelectorComponent(
        { global: resolvedPaths, project: resolvedPaths },
        settingsManager,
        projectDir,
        agentDir,
        () => {},
        () => {},
        () => {},
        24,
        "global",
      );

      const list = selector.getResourceList();
      initTheme("dark");
      expect(list.render(80).join("\n")).toContain("Built-in");
      expect(list.render(80).join("\n")).toContain("llama.cpp");
      list.handleInput(" ");
      expect(settingsManager.getGlobalSettings().extensions).toEqual(["-builtin:llama.cpp"]);
      list.handleInput(" ");
      expect(settingsManager.getGlobalSettings().extensions).toEqual(["+builtin:llama.cpp"]);
    }),
  );

const cyclesProjectBuiltInExtensionOverridesIn = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("HOME", tempDir);
      const storage = new InMemorySettingsStorage();
      storage.withLock("global", () => toJsonTextSync({ extensions: ["-builtin:mcp"] }));
      const settingsManager = SettingsManager.fromStorage(storage, { projectTrusted: true });
      const resolvedPaths = yield* awaited(
        new DefaultPackageManager({
          agentDir,
          builtinExtensions: ["mcp"],
          cwd: projectDir,
          settingsManager,
        }).resolve(),
      );
      const selector = new ConfigSelectorComponent(
        { global: resolvedPaths, project: resolvedPaths },
        settingsManager,
        projectDir,
        agentDir,
        () => {},
        () => {},
        () => {},
        24,
        "project",
      );

      const list = selector.getResourceList();
      list.handleInput(" ");
      expect(settingsManager.getProjectSettings().extensions).toEqual(["+builtin:mcp"]);
      list.handleInput(" ");
      expect(settingsManager.getProjectSettings().extensions).toEqual(["-builtin:mcp"]);
      list.handleInput(" ");
      expect(settingsManager.getProjectSettings().extensions).toEqual([]);
    }),
  );

const showsAFriendlyErrorForUnknownInstall = () =>
  runTest(
    Effect.gen(function* () {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        yield* awaited(expect(main(["install", "--unknown"])).resolves.toBeUndefined());

        const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
        expect(stderr).toContain('Unknown option --unknown for "install".');
        expect(stderr).toContain(
          'Use "msa --help" or "msa install <source> [-l] [--approve|--no-approve]".',
        );
        expect(process.exitCode).toBe(1);
      } finally {
        errorSpy.mockRestore();
      }
    }),
  );

const suggestsTheConfiguredSourceWhenUpdateInput = () =>
  runTest(
    Effect.gen(function* () {
      const settingsPath = joinPath(agentDir, "settings.json");
      yield* writeTextFile(settingsPath, yield* toJsonText({ packages: ["npm:msa-formatter"] }));

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        yield* awaited(expect(main(["update", "msa-formatter"])).resolves.toBeUndefined());

        const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
        const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
        expect(stderr).toContain("Did you mean npm:msa-formatter?");
        expect(stdout).not.toContain("Updated msa-formatter");
        expect(process.exitCode).toBe(1);

        const settings = (yield* fromJsonText(yield* readTextFile(settingsPath))) as {
          packages?: string[];
        };
        expect(settings.packages).toContain("npm:msa-formatter");
      } finally {
        errorSpy.mockRestore();
        logSpy.mockRestore();
      }
    }),
  );

const showsAFriendlyErrorForMissingInstall = () =>
  runTest(
    Effect.gen(function* () {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        yield* awaited(expect(main(["install"])).resolves.toBeUndefined());

        const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
        expect(stderr).toContain("Missing install source.");
        expect(stderr).toContain("Usage: msa install <source> [-l]");
        expect(stderr).not.toContain("at ");
        expect(process.exitCode).toBe(1);
      } finally {
        errorSpy.mockRestore();
      }
    }),
  );

describe("package commands", () => {
  beforeEach(() => runTest(setupPackageTest).then(assignState));

  afterEach(() => runTest(teardownPackageTest(state)));

  it(
    "cycles project package overrides in config local mode",
    cyclesProjectPackageOverridesInConfigLocal,
  );

  it("toggles built-in extensions in config global mode", togglesBuiltInExtensionsInConfigGlobal);

  it(
    "cycles project built-in extension overrides in config local mode",
    cyclesProjectBuiltInExtensionOverridesIn,
  );

  it("shows a friendly error for unknown install options", showsAFriendlyErrorForUnknownInstall);
});

describe("package commands", () => {
  beforeEach(() => runTest(setupPackageTest).then(assignState));

  afterEach(() => runTest(teardownPackageTest(state)));

  it(
    "suggests the configured source when update input omits the npm prefix",
    suggestsTheConfiguredSourceWhenUpdateInput,
  );

  it("shows a friendly error for missing install source", showsAFriendlyErrorForMissingInstall);
});

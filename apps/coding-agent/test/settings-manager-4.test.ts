import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import toolNames from "../src/core/orchestrator/tool-names.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import settingsManagerSupport from "./settings-manager-support.ts";
const { ORCHESTRATOR_TOOL_NAMES } = toolNames;

const { readSettings, removeSettingsDirs, withSettings } = settingsManagerSupport;

const { awaited, runTest, writeJsonFile } = testing;

afterEach(() => runTest(removeSettingsDirs));

const shouldLoadShellcommandprefixFromSettings = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, {
          shellCommandPrefix: "shopt -s expand_aliases",
        });

        const manager = openManager();

        expect(manager.resources.getShellCommandPrefix()).toBe("shopt -s expand_aliases");
      }),
    ),
  );

const shouldReturnUndefinedWhenShellcommandprefixIsNot = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { theme: "dark" });

        const manager = openManager();

        expect(manager.resources.getShellCommandPrefix()).toBeUndefined();
      }),
    ),
  );

const shouldPreserveShellcommandprefixWhenSavingUnrelatedSettings = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, {
          shellCommandPrefix: "shopt -s expand_aliases",
        });

        const manager = openManager();
        manager.display.setTheme("light");
        yield* awaited(manager.persistence.flush());

        const savedSettings = yield* readSettings(settingsPath);
        expect(savedSettings.shellCommandPrefix).toBe("shopt -s expand_aliases");
        expect(savedSettings.theme).toBe("light");
      }),
    ),
  );

const loadsGlobalDefaultsAndLetsProjectSettings = () =>
  runTest(
    withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, { defaultTools: ["read", "bash"] });

        expect(openManager().resources.getDefaultTools()).toEqual(["read", "bash"]);

        yield* writeJsonFile(projectSettingsPath, { defaultTools: ["grep"] });

        expect(openManager().resources.getDefaultTools()).toEqual(["grep"]);
      }),
    ),
  );

const preservesAnEmptyToolList = () => {
  expect(SettingsManager.inMemory({ defaultTools: [] }).resources.getDefaultTools()).toEqual([]);
  expect(SettingsManager.inMemory().resources.getDefaultTools()).toBeUndefined();
};

const appliesNameAndNameToTheDefault = () => {
  expect(
    SettingsManager.inMemory({ defaultTools: ["+codemode", "-write"] }).resources.getDefaultTools(),
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
    SettingsManager.inMemory({
      defaultTools: ["read", "+grep", "+read"],
    }).resources.getDefaultTools(),
  ).toEqual(["read", "grep"]);
};

const layersProjectModifiersOnTopOfThe = () =>
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
        expect(manager.resources.getDefaultTools()).toEqual(["read", "bash", "tool_search"]);

        manager.applyOverrides({ defaultTools: ["+codemode"] });
        expect(manager.resources.getDefaultTools()).toEqual([
          "read",
          "bash",
          "tool_search",
          "codemode",
        ]);
      }),
    ),
  );

const appliesProjectModifiersToTheBuiltIn = () =>
  runTest(
    withSettings(({ projectSettingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(projectSettingsPath, { defaultTools: ["+codemode"] });

        expect(openManager().resources.getDefaultTools()).toEqual([
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
  );

describe("SettingsManager", () => {
  describe("shellCommandPrefix", () => {
    it("should load shellCommandPrefix from settings", shouldLoadShellcommandprefixFromSettings);

    it(
      "should return undefined when shellCommandPrefix is not set",
      shouldReturnUndefinedWhenShellcommandprefixIsNot,
    );

    it(
      "should preserve shellCommandPrefix when saving unrelated settings",
      shouldPreserveShellcommandprefixWhenSavingUnrelatedSettings,
    );
  });

  describe("defaultTools", () => {
    it(
      "loads global defaults and lets project settings replace them",
      loadsGlobalDefaultsAndLetsProjectSettings,
    );

    it("preserves an empty tool list", preservesAnEmptyToolList);

    it("applies +name and -name to the default selection", appliesNameAndNameToTheDefault);

    it("layers project modifiers on top of the global selection", layersProjectModifiersOnTopOfThe);

    it(
      "applies project modifiers to the built-in defaults without a global setting",
      appliesProjectModifiersToTheBuiltIn,
    );
  });
});

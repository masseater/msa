import { getModel } from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";

import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { type InlineExtension, createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import type defaultToolsSettingSupportTypes from "./default-tools-setting-support.types.ts";

const { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest, writeJsonFile } =
  testing;

const dirs = { agentDir: "", tempDir: "" };

const prepareDirs = () =>
  runTest(
    Effect.gen(function* () {
      dirs.tempDir = yield* makeTempDir("msa-default-tools-");
      dirs.agentDir = joinPath(dirs.tempDir, "agent");
      yield* makeDirectory(dirs.agentDir);
    }),
  );

const cleanupDirs = () => runTest(dirs.tempDir === "" ? Effect.void : removePath(dirs.tempDir));

const sessionWith = (
  settingsManager: SettingsManager,
  options: defaultToolsSettingSupportTypes.ToolOptions,
  extensionFactories: InlineExtension[],
  sessionManager?: SessionManager,
) =>
  runTest(
    Effect.gen(function* () {
      const resourceLoader = new DefaultResourceLoader({
        agentDir: dirs.agentDir,
        cwd: dirs.tempDir,
        extensionFactories,
        settingsManager,
      });
      yield* awaited(resourceLoader.reload());
      const { session } = yield* awaited(
        createAgentSession({
          agentDir: dirs.agentDir,
          cwd: dirs.tempDir,
          model: getModel("anthropic-api", "claude-sonnet-4-5")!,
          resourceLoader,
          sessionManager: sessionManager ?? SessionManager.inMemory(dirs.tempDir),
          settingsManager,
          ...options,
        }),
      );
      return session;
    }),
  );

const createSession = (
  defaultTools: string[],
  options: defaultToolsSettingSupportTypes.ToolOptions = {},
  extensionFactories: InlineExtension[] = [],
) => sessionWith(SettingsManager.inMemory({ defaultTools }), options, extensionFactories);

const inactiveTool: InlineExtension = (msa) => {
  msa.registerTool({
    defaultActive: false,
    description: "Extension tool registered inactive",
    execute: () =>
      Promise.resolve({ content: [{ text: "ok", type: "text" as const }], details: {} }),
    label: "Inactive Tool",
    name: "inactive_tool",
    parameters: Type.Object({}),
  });
};

const createFileSession = (options: defaultToolsSettingSupportTypes.ToolOptions = {}) =>
  sessionWith(SettingsManager.create(dirs.tempDir, dirs.agentDir), options, [inactiveTool]);

const resumeSession = (
  sessionManager: SessionManager,
  options: defaultToolsSettingSupportTypes.ToolOptions,
  extensionFactories: InlineExtension[],
) => sessionWith(SettingsManager.inMemory(), options, extensionFactories, sessionManager);

const writeSettings = (settings: object) =>
  writeJsonFile(joinPath(dirs.agentDir, "settings.json"), settings);

const defaultToolsSettingSupport = {
  cleanupDirs,
  createFileSession,
  createSession,
  dirs,
  inactiveTool,
  prepareDirs,
  resumeSession,
  writeSettings,
};

export default defaultToolsSettingSupport;

import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";

import sdk from "../src/core/sdk.ts";
import type sdkTypes from "../src/core/sdk.types.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
import codingAgent from "../src/index.ts";
import type defaultToolsSettingSupportTypes from "./default-tools-setting-support.types.ts";

const { DefaultResourceLoader, SessionManager, SettingsManager } = codingAgent;

const { createAgentSession } = sdk;
const { getModel } = compat;

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
  settingsManager: settingsManagerTypes.SettingsManager,
  options: defaultToolsSettingSupportTypes.ToolOptions,
  extensionFactories: sdkTypes.InlineExtension[],
  sessionManager?: sessionManagerTypes.SessionManager,
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
  extensionFactories: sdkTypes.InlineExtension[] = [],
) => sessionWith(SettingsManager.inMemory({ defaultTools }), options, extensionFactories);

const inactiveTool: sdkTypes.InlineExtension = (msa) => {
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
  SettingsManager.create(dirs.tempDir, dirs.agentDir).then((settingsManager) =>
    sessionWith(settingsManager, options, [inactiveTool]),
  );

const resumeSession = (
  sessionManager: sessionManagerTypes.SessionManager,
  options: defaultToolsSettingSupportTypes.ToolOptions,
  extensionFactories: sdkTypes.InlineExtension[],
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

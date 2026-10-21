import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import toolNames from "../src/core/orchestrator/tool-names.ts";
import type sdkTypes from "../src/core/sdk.types.ts";
import defaultToolsSettingSupport from "./default-tools-setting-support.ts";

const { ORCHESTRATOR_TOOL_NAMES } = toolNames;

const { cleanupDirs, createSession, prepareDirs } = defaultToolsSettingSupport;

const { awaited, runTest } = testing;

const usesTheConfiguredListAsTheInitial = Effect.gen(function* () {
  const session = yield* awaited(createSession(["grep", "find"]));

  expect(
    session.tools.registry
      .getAllTools()
      .map((tool) => tool.name)
      .sort(),
  ).toEqual(
    [
      "bash",
      "edit",
      "find",
      "grep",
      "ls",
      "memory",
      "model_policy",
      "model_upgrade",
      "powershell",
      "pr_watch",
      "read",
      "write",
      ...ORCHESTRATOR_TOOL_NAMES,
    ].sort(),
  );
  expect(session.tools.loadout.getActiveToolNames()).toEqual(["grep", "find"]);
  expect(session.tools.prompt.systemPrompt).toContain("- grep:");
  expect(session.tools.prompt.systemPrompt).not.toContain("- read:");
  session.dispose();
});

const canSelectPowershellInsteadOfBash = Effect.gen(function* () {
  const session = yield* awaited(createSession(["read", "powershell", "edit", "write"]));

  expect(session.tools.loadout.getActiveToolNames()).toEqual([
    "read",
    "powershell",
    "edit",
    "write",
  ]);
  expect(session.tools.prompt.systemPrompt).toContain("- powershell: Execute PowerShell commands");
  expect(session.tools.prompt.systemPrompt).not.toContain("- bash:");
  session.dispose();
});

const activatesAnInactiveExtensionToolWithName = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const session = yield* awaited(
    createSession(["+inactive_tool", "-write"], {}, [
      (msa) => {
        msa.registerTool({
          defaultActive: false,
          description: "Extension tool registered inactive",
          execute: () =>
            effectRunPromise(
              awaited({ content: [{ text: "ok", type: "text" as const }], details: {} }),
            ),
          label: "Inactive Tool",
          name: "inactive_tool",
          parameters: Type.Object({}),
        });
      },
    ]),
  );

  expect(session.tools.loadout.getActiveToolNames().sort()).toEqual(
    [
      "bash",
      "edit",
      "inactive_tool",
      "memory",
      "model_policy",
      "model_upgrade",
      "pr_watch",
      "read",
      ...ORCHESTRATOR_TOOL_NAMES,
    ].sort(),
  );
  session.dispose();
});

const okTool = (name: string, label: string, description: string) => ({
  description,
  execute: () => Promise.resolve({ content: [{ text: "ok", type: "text" as const }], details: {} }),
  label,
  name,
  parameters: Type.Object({}),
});

const staticAndDynamicTools: sdkTypes.InlineExtension = (msa) => {
  msa.registerTool(okTool("static_tool", "Static Tool", "Statically registered extension tool"));
  msa.on("session_start", () => {
    msa.registerTool(
      okTool("dynamic_tool", "Dynamic Tool", "Dynamically registered extension tool"),
    );
  });
};

const keepsExtensionAndSdkCustomToolsEnabledSetup = () =>
  Effect.map(
    awaited(
      createSession(
        ["grep"],
        { customTools: [okTool("sdk_tool", "SDK Tool", "SDK custom tool")] },
        [staticAndDynamicTools],
      ),
    ),
    (session) => ({ session }),
  );

const keepsExtensionAndSdkCustomToolsEnabled = Effect.gen(function* () {
  const { session } = yield* keepsExtensionAndSdkCustomToolsEnabledSetup();
  yield* awaited(session.extensions.binding.bindExtensions({}));

  expect(session.tools.loadout.getActiveToolNames().sort()).toEqual([
    "dynamic_tool",
    "grep",
    "sdk_tool",
    "static_tool",
  ]);
  expect(session.tools.registry.getAllTools().map((tool) => tool.name)).toEqual(
    expect.arrayContaining(["read", "dynamic_tool", "sdk_tool", "static_tool"]),
  );
  session.dispose();
});

const preservesExplicitToolOptionPrecedence = Effect.gen(function* () {
  const allowlistedSession = yield* awaited(createSession(["grep"], { tools: ["read"] }));
  expect(allowlistedSession.tools.loadout.getActiveToolNames()).toEqual(["read"]);
  allowlistedSession.dispose();

  const excludedSession = yield* awaited(
    createSession(["read", "grep"], { excludeTools: ["read"] }),
  );
  expect(excludedSession.tools.loadout.getActiveToolNames()).toEqual(["grep"]);
  excludedSession.dispose();

  const toolLessSession = yield* awaited(createSession(["read"], { noTools: "all" }));
  expect(toolLessSession.tools.registry.getAllTools()).toEqual([]);
  expect(toolLessSession.tools.loadout.getActiveToolNames()).toEqual([]);
  toolLessSession.dispose();
});

describe("defaultTools setting", () => {
  beforeEach(prepareDirs);

  afterEach(cleanupDirs);

  it("uses the configured list as the initial built-in selection", () =>
    runTest(usesTheConfiguredListAsTheInitial));

  it("can select powershell instead of bash", () => runTest(canSelectPowershellInsteadOfBash));

  it("activates an inactive extension tool with +name", () =>
    runTest(activatesAnInactiveExtensionToolWithName));

  it("keeps extension and SDK custom tools enabled", () =>
    runTest(keepsExtensionAndSdkCustomToolsEnabled));

  it("preserves explicit tool option precedence", () =>
    runTest(preservesExplicitToolOptionPrecedence));
});

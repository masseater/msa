import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const { getModel } = compat;

const { awaited, joinPath, makeDirectory, makeTempDir, removeDirs, runTest } = testing;

const examplesDir = joinPath(import.meta.dirname, "../examples/extensions");

interface SessionDirs {
  readonly tempDir: string;
  readonly agentDir: string;
}

const tempDirs: string[] = [];

afterEach(() => runTest(removeDirs(tempDirs.splice(0))));

const createSessionDirs: Effect.Effect<SessionDirs> = Effect.gen(function* () {
  const tempDir = yield* makeTempDir("msa-tool-renderer-example-test-");
  tempDirs.push(tempDir);
  const agentDir = joinPath(tempDir, "agent");
  yield* makeDirectory(agentDir);
  return { agentDir, tempDir };
});

type EditToolDefinition = NonNullable<ConstructorParameters<typeof ToolExecutionComponent>[4]>;

const getSessionState = (
  { tempDir, agentDir }: SessionDirs,
  extensionPath: string | undefined,
  tools: string[],
): Effect.Effect<{ systemPrompt: string; editToolDefinition: EditToolDefinition | undefined }> =>
  Effect.gen(function* () {
    const settingsManager = SettingsManager.inMemory();
    const resourceLoader = new DefaultResourceLoader({
      additionalExtensionPaths: extensionPath === undefined ? [] : [extensionPath],
      agentDir,
      cwd: tempDir,
      noContextFiles: true,
      noExtensions: true,
      noPromptTemplates: true,
      noSkills: true,
      noThemes: true,
      settingsManager,
    });
    yield* awaited(resourceLoader.reload());
    expect(resourceLoader.getExtensions().errors).toEqual([]);
    const { session } = yield* awaited(
      createAgentSession({
        agentDir,
        cwd: tempDir,
        model: getModel("anthropic-api", "claude-sonnet-4-5"),
        resourceLoader,
        sessionManager: SessionManager.inMemory(tempDir),
        settingsManager,
        tools,
      }),
    );
    try {
      return {
        editToolDefinition: session.getToolDefinition("edit"),
        systemPrompt: session.systemPrompt,
      };
    } finally {
      session.dispose();
    }
  });

const keepsMinimalModeSEditToolIn = () =>
  runTest(
    Effect.gen(function* () {
      const dirs = yield* createSessionDirs;
      const minimalMode = yield* getSessionState(dirs, joinPath(examplesDir, "minimal-mode.ts"), [
        "edit",
      ]);
      const editToolDefinition = minimalMode.editToolDefinition;
      if (editToolDefinition === undefined)
        throw new Error("minimal mode did not register the edit tool");
      const { renderShell: _renderShell, ...defaultShellDefinition } = editToolDefinition;

      expect(renderEditTool(editToolDefinition, dirs.tempDir)).toEqual(
        renderEditTool(defaultShellDefinition, dirs.tempDir),
      );
    }),
  );

describe("tool renderer examples", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  it.each([
    {
      extensionPath: joinPath(examplesDir, "built-in-tool-renderer.ts"),
      name: "built-in tool renderer",
      tools: ["read", "bash", "edit", "write"],
    },
    {
      extensionPath: joinPath(examplesDir, "minimal-mode.ts"),
      name: "minimal mode",
      tools: ["read", "bash", "write", "edit", "find", "grep", "ls"],
    },
  ])("keeps the system prompt unchanged for the $name example", ({ extensionPath, tools }) =>
    runTest(
      Effect.gen(function* () {
        const dirs = yield* createSessionDirs;
        const baseline = yield* getSessionState(dirs, undefined, tools);
        const withRenderer = yield* getSessionState(dirs, extensionPath, tools);

        expect(withRenderer.systemPrompt).toBe(baseline.systemPrompt);
      }),
    ),
  );

  it("keeps minimal mode's edit tool in the default shell", keepsMinimalModeSEditToolIn);
});

function renderEditTool(definition: EditToolDefinition, cwd: string): string[] {
  const component = new ToolExecutionComponent(
    "edit",
    "edit-shell-test",
    { newText: "after", oldText: "before", path: "notes.txt" },
    {},
    definition,
    { requestRender() {} } as unknown as ConstructorParameters<typeof ToolExecutionComponent>[5],
    cwd,
  );
  return component.render(40);
}

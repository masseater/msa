import { tmpdir } from "node:os";

import { getModel } from "@msa/ai/compat";
import {
  awaited,
  runTest,
  currentTimeMillis,
  randomSuffixSync,
  joinPath,
  pathExists,
  makeDirectory,
  removePath,
} from "@msa/testing";
import type { TUI } from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import type { ToolDefinition } from "../src/core/extensions/types.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const examplesDir = joinPath(import.meta.dirname, "../examples/extensions");

describe("tool renderer examples", () => {
  let tempDir: string;
  let agentDir: string;

  beforeAll(() => {
    initTheme("dark");
  });

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = joinPath(
          tmpdir(),
          `msa-tool-renderer-example-test-${currentTimeMillis()}-${randomSuffixSync()}`,
        );
        agentDir = joinPath(tempDir, "agent");
        yield* makeDirectory(agentDir);
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        if (tempDir.length > 0 && (yield* pathExists(tempDir))) {
          yield* removePath(tempDir);
        }
      }),
    ),
  );

  function getSessionState(extensionPath: string | undefined, tools: string[]) {
    return runTest(
      Effect.gen(function* () {
        const settingsManager = SettingsManager.inMemory();
        const resourceLoader = new DefaultResourceLoader({
          cwd: tempDir,
          agentDir,
          settingsManager,
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          additionalExtensionPaths:
            extensionPath !== undefined && extensionPath.length > 0 ? [extensionPath] : [],
        });
        yield* awaited(resourceLoader.reload());
        expect(resourceLoader.getExtensions().errors).toEqual([]);
        const { session } = yield* awaited(
          createAgentSession({
            cwd: tempDir,
            agentDir,
            model: getModel("anthropic", "claude-sonnet-4-5"),
            settingsManager,
            sessionManager: SessionManager.inMemory(tempDir),
            resourceLoader,
            tools,
          }),
        );
        try {
          return yield* awaited({
            systemPrompt: session.systemPrompt,
            editToolDefinition: session.getToolDefinition("edit"),
          });
        } finally {
          session.dispose();
        }
      }),
    );
  }

  it.each([
    {
      name: "built-in tool renderer",
      extensionPath: joinPath(examplesDir, "built-in-tool-renderer.ts"),
      tools: ["read", "bash", "edit", "write"],
    },
    {
      name: "minimal mode",
      extensionPath: joinPath(examplesDir, "minimal-mode.ts"),
      tools: ["read", "bash", "write", "edit", "find", "grep", "ls"],
    },
  ])("keeps the system prompt unchanged for the $name example", ({ extensionPath, tools }) =>
    runTest(
      Effect.gen(function* () {
        const baseline = yield* awaited(getSessionState(undefined, tools));
        const withRenderer = yield* awaited(getSessionState(extensionPath, tools));

        expect(withRenderer.systemPrompt).toBe(baseline.systemPrompt);
      }),
    ),
  );

  it("keeps minimal mode's edit tool in the default shell", () =>
    runTest(
      Effect.gen(function* () {
        const minimalMode = yield* awaited(
          getSessionState(joinPath(examplesDir, "minimal-mode.ts"), ["edit"]),
        );
        const editToolDefinition = minimalMode.editToolDefinition;
        if (!(editToolDefinition !== undefined))
          throw new Error("minimal mode did not register the edit tool");
        const { renderShell: _renderShell, ...defaultShellDefinition } = editToolDefinition;

        expect(renderEditTool(editToolDefinition, tempDir)).toEqual(
          renderEditTool(defaultShellDefinition, tempDir),
        );
      }),
    ));
});

function renderEditTool(definition: ToolDefinition, cwd: string): string[] {
  const component = new ToolExecutionComponent(
    "edit",
    "edit-shell-test",
    { path: "notes.txt", oldText: "before", newText: "after" },
    {},
    definition,
    { requestRender() {} } as unknown as TUI,
    cwd,
  );
  return component.render(40);
}

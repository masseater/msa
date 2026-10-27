import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import toolNames from "../../../src/core/orchestrator/tool-names.ts";
import regression3592Support from "./3592-no-builtin-tools-keeps-extension-tools-support.ts";

const { ORCHESTRATOR_TOOL_NAMES } = toolNames;

const { cleanupDirs, createSession, prepareDirs } = regression3592Support;

const keepsExtensionToolsActiveWhenBuilt = Effect.gen(function* () {
  const session = yield* Effect.promise(() => createSession({ noTools: "builtin" }));

  expect(
    session.tools.registry
      .getAllTools()
      .map((tool) => tool.name)
      .sort(),
  ).toEqual(
    [
      "bash",
      "dynamic_tool",
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
      "search_sessions",
      "write",
      ...ORCHESTRATOR_TOOL_NAMES,
    ].sort(),
  );
  expect(session.tools.loadout.getActiveToolNames()).toEqual(["dynamic_tool"]);
  expect(session.tools.prompt.systemPrompt).toContain("- dynamic_tool: Run dynamic test behavior");
  expect(session.tools.prompt.systemPrompt).not.toContain("- read:");
  expect(session.tools.prompt.systemPrompt).not.toContain("- bash:");
  session.dispose();
});

const keepsExtensionToolsActiveWhenBuiltIn = () =>
  Effect.runPromise(keepsExtensionToolsActiveWhenBuilt);

describe("regression #3592: no-builtin-tools keeps extension tools enabled", () => {
  beforeEach(prepareDirs);

  afterEach(cleanupDirs);

  it(
    "keeps extension tools active when built-in defaults are disabled",
    keepsExtensionToolsActiveWhenBuiltIn,
  );
});

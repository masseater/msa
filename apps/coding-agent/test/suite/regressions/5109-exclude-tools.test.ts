import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import type { ExtensionFactory } from "../../../src/index.ts";
import harnessModule from "../harness.ts";

const { createHarness } = harnessModule;

function toolNames(tools: Array<{ name: string }>): string[] {
  return tools.map((tool) => tool.name).sort();
}

const extensionFactories: ExtensionFactory[] = [
  (msa) => {
    msa.on("session_start", () => {
      msa.registerTool({
        description: "Ask a question",
        execute: () =>
          Promise.resolve({
            content: [{ text: "ok", type: "text" }],
            details: {},
          }),
        label: "Ask Question",
        name: "ask_question",
        parameters: Type.Object({}),
        promptSnippet: "Ask a question",
      });
      msa.registerTool({
        description: "Dynamic test tool",
        execute: () =>
          Promise.resolve({
            content: [{ text: "ok", type: "text" }],
            details: {},
          }),
        label: "Dynamic Tool",
        name: "dynamic_tool",
        parameters: Type.Object({}),
        promptSnippet: "Run dynamic test behavior",
      });
    });
  },
];

const filtersBuiltInAndExtensionTools = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      excludedToolNames: ["read", "ask_question"],
      extensionFactories,
    }),
  );
  try {
    yield* Effect.promise(() => harness.session.bindExtensions({}));

    const allToolNames = toolNames(harness.session.getAllTools());
    expect(allToolNames).not.toContain("read");
    expect(allToolNames).not.toContain("ask_question");
    expect(allToolNames).toContain("bash");
    expect(allToolNames).toContain("dynamic_tool");
    expect(harness.session.getActiveToolNames().sort()).toEqual([
      "bash",
      "dynamic_tool",
      "edit",
      "memory",
      "model_policy",
      "model_upgrade",
      "pr_watch",
      "write",
    ]);
    expect(harness.session.systemPrompt).not.toContain("- read:");
    expect(harness.session.systemPrompt).not.toContain("ask_question");
    expect(harness.session.systemPrompt).toContain("- dynamic_tool: Run dynamic test behavior");
  } finally {
    harness.cleanup();
  }
});

const letsExcludedToolsOverrideTheAllowlist = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      allowedToolNames: ["read", "bash", "ask_question"],
      excludedToolNames: ["read", "ask_question"],
      extensionFactories,
      initialActiveToolNames: ["read", "bash", "ask_question"],
    }),
  );
  try {
    yield* Effect.promise(() => harness.session.bindExtensions({}));

    expect(toolNames(harness.session.getAllTools())).toEqual(["bash"]);
    expect(harness.session.getActiveToolNames()).toEqual(["bash"]);
    expect(harness.session.systemPrompt).toContain("- bash:");
    expect(harness.session.systemPrompt).not.toContain("- read:");
    expect(harness.session.systemPrompt).not.toContain("ask_question");
  } finally {
    harness.cleanup();
  }
});

const matchesAllowlistAndDenylistPatterns = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      allowedToolNames: ["*_tool", "ask_*", "re*"],
      excludedToolNames: ["ask*"],
      extensionFactories,
      initialActiveToolNames: ["*_tool", "ask_*", "re*"],
    }),
  );
  try {
    yield* Effect.promise(() => harness.session.bindExtensions({}));

    expect(toolNames(harness.session.getAllTools())).toEqual(["dynamic_tool", "read"]);
    expect(harness.session.getActiveToolNames().sort()).toEqual(["dynamic_tool", "read"]);
  } finally {
    harness.cleanup();
  }
});

const filtersBuiltInAndExtensionToolsFrom = () =>
  Effect.runPromise(filtersBuiltInAndExtensionTools);

const letsExcludedToolsOverrideTheAllowlist2 = () =>
  Effect.runPromise(letsExcludedToolsOverrideTheAllowlist);

const matchesAllowlistAndDenylistPatterns2 = () =>
  Effect.runPromise(matchesAllowlistAndDenylistPatterns);

describe("regression #5109: exclude tools", () => {
  it(
    "filters built-in and extension tools from available and active tools",
    filtersBuiltInAndExtensionToolsFrom,
  );
  it("lets excluded tools override the allowlist", letsExcludedToolsOverrideTheAllowlist2);
  it("matches allowlist and denylist patterns", matchesAllowlistAndDenylistPatterns2);
});

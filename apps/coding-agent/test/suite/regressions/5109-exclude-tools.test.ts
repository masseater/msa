import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import type { ExtensionFactory } from "../../../src/index.ts";
import { createHarness } from "../harness.ts";

function toolNames(tools: Array<{ name: string }>): string[] {
  return tools.map((tool) => tool.name).sort();
}

const extensionFactories: ExtensionFactory[] = [
  (msa) => {
    msa.on("session_start", () => {
      msa.registerTool({
        name: "ask_question",
        label: "Ask Question",
        description: "Ask a question",
        promptSnippet: "Ask a question",
        parameters: Type.Object({}),
        execute: () =>
          Promise.resolve({
            content: [{ type: "text", text: "ok" }],
            details: {},
          }),
      });
      msa.registerTool({
        name: "dynamic_tool",
        label: "Dynamic Tool",
        description: "Dynamic test tool",
        promptSnippet: "Run dynamic test behavior",
        parameters: Type.Object({}),
        execute: () =>
          Promise.resolve({
            content: [{ type: "text", text: "ok" }],
            details: {},
          }),
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
      initialActiveToolNames: ["read", "bash", "ask_question"],
      extensionFactories,
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
      initialActiveToolNames: ["*_tool", "ask_*", "re*"],
      extensionFactories,
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

describe("regression #5109: exclude tools", () => {
  it("filters built-in and extension tools from available and active tools", () =>
    Effect.runPromise(filtersBuiltInAndExtensionTools));
  it("lets excluded tools override the allowlist", () =>
    Effect.runPromise(letsExcludedToolsOverrideTheAllowlist));
  it("matches allowlist and denylist patterns", () =>
    Effect.runPromise(matchesAllowlistAndDenylistPatterns));
});

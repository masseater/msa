import { tmpdir } from "node:os";

import { getModel } from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const {
  awaited,
  currentTimeMillis,
  joinPath,
  makeDirectory,
  pathExists,
  randomSuffixSync,
  removePath,
  runTest,
} = testing;

let tempDir: string;

let agentDir: string;

const refreshesToolRegistryWhenToolsAreRegisteredPart1 = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const settingsManager = SettingsManager.create(tempDir, agentDir);
    const sessionManager = SessionManager.inMemory();

    const resourceLoader = new DefaultResourceLoader({
      agentDir,
      cwd: tempDir,
      extensionFactories: [
        (msa) => {
          msa.on("session_start", () => {
            msa.registerTool({
              description: "Tool registered from session_start",
              execute: () =>
                effectRunPromise(
                  awaited({
                    content: [{ text: "ok", type: "text" as const }],
                    details: {},
                  }),
                ),
              label: "Dynamic Tool",
              name: "dynamic_tool",
              parameters: Type.Object({}),
              promptGuidelines: ["Use dynamic_tool when the user asks for dynamic behavior tests."],
              promptSnippet: "Run dynamic test behavior",
            });
          });
        },
      ],
      settingsManager,
    });
    return { resourceLoader, sessionManager, settingsManager };
  });

const refreshesToolRegistryWhenToolsAreRegistered = Effect.gen(function* () {
  const { resourceLoader, sessionManager, settingsManager } =
    yield* refreshesToolRegistryWhenToolsAreRegisteredPart1();
  yield* awaited(resourceLoader.reload());

  const { session } = yield* awaited(
    createAgentSession({
      agentDir,
      cwd: tempDir,
      model: getModel("anthropic-api", "claude-sonnet-4-5")!,
      resourceLoader,
      sessionManager,
      settingsManager,
    }),
  );

  expect(session.getAllTools().map((tool) => tool.name)).not.toContain("dynamic_tool");

  yield* awaited(session.bindExtensions({}));

  const allTools = session.getAllTools();
  const dynamicTool = allTools.find((tool) => tool.name === "dynamic_tool");
  const readTool = allTools.find((tool) => tool.name === "read");

  expect(allTools.map((tool) => tool.name)).toContain("dynamic_tool");
  expect(dynamicTool?.promptGuidelines).toEqual([
    "Use dynamic_tool when the user asks for dynamic behavior tests.",
  ]);
  expect(dynamicTool?.sourceInfo).toMatchObject({
    origin: "top-level",
    path: "<inline:1>",
    scope: "temporary",
    source: "inline",
  });
  expect(readTool?.sourceInfo).toMatchObject({
    origin: "top-level",
    path: "builtin:read",
    scope: "temporary",
    source: "builtin",
  });
  expect(session.getActiveToolNames()).toContain("dynamic_tool");
  expect(session.systemPrompt).toContain("- dynamic_tool: Run dynamic test behavior");
  expect(session.systemPrompt).toContain(
    "- Use dynamic_tool when the user asks for dynamic behavior tests.",
  );

  session.dispose();
});

const returnsSourceMetadataForSdkCustomTools = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const settingsManager = SettingsManager.create(tempDir, agentDir);
  const sessionManager = SessionManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    agentDir,
    cwd: tempDir,
    settingsManager,
  });
  yield* awaited(resourceLoader.reload());

  const { session } = yield* awaited(
    createAgentSession({
      agentDir,
      customTools: [
        {
          description: "Tool registered through createAgentSession",
          execute: () =>
            effectRunPromise(
              awaited({
                content: [{ text: "ok", type: "text" as const }],
                details: {},
              }),
            ),
          label: "SDK Tool",
          name: "sdk_tool",
          parameters: Type.Object({}),
        },
      ],
      cwd: tempDir,
      model: getModel("anthropic-api", "claude-sonnet-4-5")!,
      resourceLoader,
      sessionManager,
      settingsManager,
    }),
  );

  const sdkTool = session.getAllTools().find((tool) => tool.name === "sdk_tool");
  expect(sdkTool?.sourceInfo).toMatchObject({
    origin: "top-level",
    path: "<sdk:sdk_tool>",
    scope: "temporary",
    source: "sdk",
  });
  expect(session.getActiveToolNames()).toContain("sdk_tool");

  session.dispose();
});

const beforeEachHook = Effect.gen(function* () {
  tempDir = joinPath(
    tmpdir(),
    `msa-dynamic-tool-test-${currentTimeMillis()}-${randomSuffixSync()}`,
  );
  agentDir = joinPath(tempDir, "agent");
  yield* makeDirectory(agentDir);
});

const afterEachHook = Effect.gen(function* () {
  if (tempDir.length > 0 && (yield* pathExists(tempDir))) {
    yield* removePath(tempDir);
  }
});

describe("AgentSession dynamic tool registration", () => {
  beforeEach(() => runTest(beforeEachHook));

  afterEach(() => runTest(afterEachHook));

  it("refreshes tool registry when tools are registered after initialization", () =>
    runTest(refreshesToolRegistryWhenToolsAreRegistered));
});

describe("AgentSession dynamic tool registration", () => {
  beforeEach(() => runTest(beforeEachHook));

  afterEach(() => runTest(afterEachHook));

  it("returns source metadata for SDK custom tools", () =>
    runTest(returnsSourceMetadataForSdkCustomTools));
});

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
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createBashTool } from "../src/core/tools/bash.ts";

describe("AgentSession dynamic tool registration", () => {
  let tempDir: string;
  let agentDir: string;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = joinPath(
          tmpdir(),
          `msa-dynamic-tool-test-${currentTimeMillis()}-${randomSuffixSync()}`,
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

  it("exposes session state before custom bash spawn hooks and supports opting out", () =>
    runTest(
      Effect.gen(function* () {
        const settingsManager = SettingsManager.create(tempDir, agentDir);
        const sessionManager = SessionManager.create(tempDir, joinPath(agentDir, "sessions"), {
          id: "bash-env-test",
        });
        let sessionEnv: NodeJS.ProcessEnv | undefined;
        let optedOutEnv: NodeJS.ProcessEnv | undefined;
        const resourceLoader = new DefaultResourceLoader({
          cwd: tempDir,
          agentDir,
          settingsManager,
          extensionFactories: [
            (msa) => {
              msa.registerTool(
                createBashTool(tempDir, {
                  spawnHook: (ctx) => {
                    sessionEnv = ctx.env;
                    return ctx;
                  },
                }),
              );
              msa.registerTool({
                ...createBashTool(tempDir, {
                  exposeSessionEnvironment: false,
                  spawnHook: (ctx) => {
                    optedOutEnv = ctx.env;
                    return ctx;
                  },
                }),
                name: "bash_without_session_env",
                label: "bash without session env",
              });
            },
          ],
        });
        yield* awaited(resourceLoader.reload());

        const model = getModel("anthropic-api", "claude-sonnet-4-5")!;
        const { session } = yield* awaited(
          createAgentSession({
            cwd: tempDir,
            agentDir,
            model,
            thinkingLevel: "high",
            settingsManager,
            sessionManager,
            resourceLoader,
          }),
        );

        const bashTool = session.agent.state.tools.find((tool) => tool.name === "bash")!;
        expect(session.systemPrompt).toContain(
          "You can inspect MSA_* environment variables for current model and session details.",
        );
        yield* awaited(bashTool.execute("bash-env", { command: "printf ok" }));
        expect(sessionEnv).toMatchObject({
          MSA_SESSION_ID: session.sessionId,
          MSA_SESSION_FILE: session.sessionFile,
          MSA_PROVIDER: model.provider,
          MSA_MODEL: model.id,
          MSA_REASONING_LEVEL: session.thinkingLevel,
        });

        const optedOutBashTool = session.agent.state.tools.find(
          (tool) => tool.name === "bash_without_session_env",
        )!;
        yield* awaited(optedOutBashTool.execute("bash-no-env", { command: "printf ok" }));
        expect(optedOutEnv).not.toHaveProperty("MSA_SESSION_ID");
        expect(optedOutEnv).not.toHaveProperty("MSA_SESSION_FILE");
        expect(optedOutEnv).not.toHaveProperty("MSA_PROVIDER");
        expect(optedOutEnv).not.toHaveProperty("MSA_MODEL");
        expect(optedOutEnv).not.toHaveProperty("MSA_REASONING_LEVEL");

        session.dispose();
      }),
    ));

  it("refreshes tool registry when tools are registered after initialization", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const settingsManager = SettingsManager.create(tempDir, agentDir);
        const sessionManager = SessionManager.inMemory();

        const resourceLoader = new DefaultResourceLoader({
          cwd: tempDir,
          agentDir,
          settingsManager,
          extensionFactories: [
            (msa) => {
              msa.on("session_start", () => {
                msa.registerTool({
                  name: "dynamic_tool",
                  label: "Dynamic Tool",
                  description: "Tool registered from session_start",
                  promptSnippet: "Run dynamic test behavior",
                  promptGuidelines: [
                    "Use dynamic_tool when the user asks for dynamic behavior tests.",
                  ],
                  parameters: Type.Object({}),
                  execute: () =>
                    effectRunPromise(
                      awaited({
                        content: [{ type: "text" as const, text: "ok" }],
                        details: {},
                      }),
                    ),
                });
              });
            },
          ],
        });
        yield* awaited(resourceLoader.reload());

        const { session } = yield* awaited(
          createAgentSession({
            cwd: tempDir,
            agentDir,
            model: getModel("anthropic-api", "claude-sonnet-4-5")!,
            settingsManager,
            sessionManager,
            resourceLoader,
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
          path: "<inline:1>",
          source: "inline",
          scope: "temporary",
          origin: "top-level",
        });
        expect(readTool?.sourceInfo).toMatchObject({
          path: "builtin:read",
          source: "builtin",
          scope: "temporary",
          origin: "top-level",
        });
        expect(session.getActiveToolNames()).toContain("dynamic_tool");
        expect(session.systemPrompt).toContain("- dynamic_tool: Run dynamic test behavior");
        expect(session.systemPrompt).toContain(
          "- Use dynamic_tool when the user asks for dynamic behavior tests.",
        );

        session.dispose();
      }),
    ));

  it("returns source metadata for SDK custom tools", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const settingsManager = SettingsManager.create(tempDir, agentDir);
        const sessionManager = SessionManager.inMemory();
        const resourceLoader = new DefaultResourceLoader({
          cwd: tempDir,
          agentDir,
          settingsManager,
        });
        yield* awaited(resourceLoader.reload());

        const { session } = yield* awaited(
          createAgentSession({
            cwd: tempDir,
            agentDir,
            model: getModel("anthropic-api", "claude-sonnet-4-5")!,
            settingsManager,
            sessionManager,
            resourceLoader,
            customTools: [
              {
                name: "sdk_tool",
                label: "SDK Tool",
                description: "Tool registered through createAgentSession",
                parameters: Type.Object({}),
                execute: () =>
                  effectRunPromise(
                    awaited({
                      content: [{ type: "text" as const, text: "ok" }],
                      details: {},
                    }),
                  ),
              },
            ],
          }),
        );

        const sdkTool = session.getAllTools().find((tool) => tool.name === "sdk_tool");
        expect(sdkTool?.sourceInfo).toMatchObject({
          path: "<sdk:sdk_tool>",
          source: "sdk",
          scope: "temporary",
          origin: "top-level",
        });
        expect(session.getActiveToolNames()).toContain("sdk_tool");

        session.dispose();
      }),
    ));

  it("keeps custom tools active but omits them from available tools when promptSnippet is not provided", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const settingsManager = SettingsManager.create(tempDir, agentDir);
        const sessionManager = SessionManager.inMemory();

        const resourceLoader = new DefaultResourceLoader({
          cwd: tempDir,
          agentDir,
          settingsManager,
          extensionFactories: [
            (msa) => {
              msa.on("session_start", () => {
                msa.registerTool({
                  name: "hidden_tool",
                  label: "Hidden Tool",
                  description: "Description should not appear in available tools",
                  parameters: Type.Object({}),
                  execute: () =>
                    effectRunPromise(
                      awaited({
                        content: [{ type: "text" as const, text: "ok" }],
                        details: {},
                      }),
                    ),
                });
              });
            },
          ],
        });
        yield* awaited(resourceLoader.reload());

        const { session } = yield* awaited(
          createAgentSession({
            cwd: tempDir,
            agentDir,
            model: getModel("anthropic-api", "claude-sonnet-4-5")!,
            settingsManager,
            sessionManager,
            resourceLoader,
          }),
        );

        yield* awaited(session.bindExtensions({}));

        expect(session.getAllTools().map((tool) => tool.name)).toContain("hidden_tool");
        expect(session.getActiveToolNames()).toContain("hidden_tool");
        expect(session.systemPrompt).not.toContain("hidden_tool");
        expect(session.systemPrompt).not.toContain(
          "Description should not appear in available tools",
        );

        session.dispose();
      }),
    ));
});

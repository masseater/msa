import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { getModel } from "@msa/ai/compat";
import { awaited, runTest, currentTimeMillis, randomSuffixSync, joinPath } from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  createAgentSessionFromServices,
  createAgentSessionServices,
} from "../src/core/agent-session-services.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import {
  type CreateAgentSessionOptions,
  createAgentSession,
  type InlineExtension,
} from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

type ToolOptions = Pick<
  CreateAgentSessionOptions,
  "tools" | "excludeTools" | "noTools" | "customTools"
>;

describe("defaultTools setting", () => {
  let tempDir: string;
  let agentDir: string;

  beforeEach(() => {
    tempDir = joinPath(tmpdir(), `msa-default-tools-${currentTimeMillis()}-${randomSuffixSync()}`);
    agentDir = joinPath(tempDir, "agent");
    mkdirSync(agentDir, { recursive: true });
  });

  afterEach(() => {
    if (tempDir.length > 0 && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createSession(
    defaultTools: string[],
    options: ToolOptions = {},
    extensionFactories: InlineExtension[] = [],
  ) {
    return runTest(
      Effect.gen(function* () {
        const settingsManager = SettingsManager.inMemory({ defaultTools });
        const resourceLoader = new DefaultResourceLoader({
          cwd: tempDir,
          agentDir,
          settingsManager,
          extensionFactories,
        });
        yield* awaited(resourceLoader.reload());

        return yield* awaited(
          (yield* awaited(
            createAgentSession({
              cwd: tempDir,
              agentDir,
              model: getModel("anthropic", "claude-sonnet-4-5")!,
              settingsManager,
              sessionManager: SessionManager.inMemory(tempDir),
              resourceLoader,
              ...options,
            }),
          )).session,
        );
      }),
    );
  }

  it("uses the configured list as the initial built-in selection", () =>
    runTest(
      Effect.gen(function* () {
        const session = yield* awaited(createSession(["grep", "find"]));

        expect(
          session
            .getAllTools()
            .map((tool) => tool.name)
            .sort(),
        ).toEqual(["bash", "edit", "find", "grep", "ls", "memory", "powershell", "read", "write"]);
        expect(session.getActiveToolNames()).toEqual(["grep", "find"]);
        expect(session.systemPrompt).toContain("- grep:");
        expect(session.systemPrompt).not.toContain("- read:");
        session.dispose();
      }),
    ));

  it("can select powershell instead of bash", () =>
    runTest(
      Effect.gen(function* () {
        const session = yield* awaited(createSession(["read", "powershell", "edit", "write"]));

        expect(session.getActiveToolNames()).toEqual(["read", "powershell", "edit", "write"]);
        expect(session.systemPrompt).toContain("- powershell: Execute PowerShell commands");
        expect(session.systemPrompt).not.toContain("- bash:");
        session.dispose();
      }),
    ));

  it("activates an inactive extension tool with +name", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const session = yield* awaited(
          createSession(["+inactive_tool", "-write"], {}, [
            (msa) => {
              msa.registerTool({
                name: "inactive_tool",
                label: "Inactive Tool",
                description: "Extension tool registered inactive",
                parameters: Type.Object({}),
                execute: () =>
                  effectRunPromise(
                    awaited({ content: [{ type: "text" as const, text: "ok" }], details: {} }),
                  ),
                defaultActive: false,
              });
            },
          ]),
        );

        expect(session.getActiveToolNames().sort()).toEqual([
          "bash",
          "edit",
          "inactive_tool",
          "memory",
          "read",
        ]);
        session.dispose();
      }),
    ));

  it("keeps extension and SDK custom tools enabled", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const session = yield* awaited(
          createSession(
            ["grep"],
            {
              customTools: [
                {
                  name: "sdk_tool",
                  label: "SDK Tool",
                  description: "SDK custom tool",
                  parameters: Type.Object({}),
                  execute: () =>
                    effectRunPromise(
                      awaited({ content: [{ type: "text" as const, text: "ok" }], details: {} }),
                    ),
                },
              ],
            },
            [
              (msa) => {
                msa.registerTool({
                  name: "static_tool",
                  label: "Static Tool",
                  description: "Statically registered extension tool",
                  parameters: Type.Object({}),
                  execute: () =>
                    effectRunPromise(
                      awaited({ content: [{ type: "text" as const, text: "ok" }], details: {} }),
                    ),
                });
                msa.on("session_start", () => {
                  msa.registerTool({
                    name: "dynamic_tool",
                    label: "Dynamic Tool",
                    description: "Dynamically registered extension tool",
                    parameters: Type.Object({}),
                    execute: () =>
                      effectRunPromise(
                        awaited({ content: [{ type: "text" as const, text: "ok" }], details: {} }),
                      ),
                  });
                });
              },
            ],
          ),
        );
        yield* awaited(session.bindExtensions({}));

        expect(session.getActiveToolNames().sort()).toEqual([
          "dynamic_tool",
          "grep",
          "sdk_tool",
          "static_tool",
        ]);
        expect(session.getAllTools().map((tool) => tool.name)).toEqual(
          expect.arrayContaining(["read", "dynamic_tool", "sdk_tool", "static_tool"]),
        );
        session.dispose();
      }),
    ));

  it("preserves explicit tool option precedence", () =>
    runTest(
      Effect.gen(function* () {
        const allowlistedSession = yield* awaited(createSession(["grep"], { tools: ["read"] }));
        expect(allowlistedSession.getActiveToolNames()).toEqual(["read"]);
        allowlistedSession.dispose();

        const excludedSession = yield* awaited(
          createSession(["read", "grep"], { excludeTools: ["read"] }),
        );
        expect(excludedSession.getActiveToolNames()).toEqual(["grep"]);
        excludedSession.dispose();

        const toolLessSession = yield* awaited(createSession(["read"], { noTools: "all" }));
        expect(toolLessSession.getAllTools()).toEqual([]);
        expect(toolLessSession.getActiveToolNames()).toEqual([]);
        toolLessSession.dispose();
      }),
    ));

  it("applies +name and -name tool options to the default selection", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const inactiveTool: InlineExtension = (msa) => {
          msa.registerTool({
            name: "inactive_tool",
            label: "Inactive Tool",
            description: "Extension tool registered inactive",
            parameters: Type.Object({}),
            execute: () =>
              effectRunPromise(
                awaited({ content: [{ type: "text" as const, text: "ok" }], details: {} }),
              ),
            defaultActive: false,
          });
          msa.registerTool({
            name: "active_tool",
            label: "Active Tool",
            description: "Extension tool registered active",
            parameters: Type.Object({}),
            execute: () =>
              effectRunPromise(
                awaited({ content: [{ type: "text" as const, text: "ok" }], details: {} }),
              ),
          });
        };

        const session = yield* awaited(
          createSession(["+grep"], { tools: ["+inactive_tool", "-write"] }, [inactiveTool]),
        );
        expect(session.getActiveToolNames().sort()).toEqual([
          "active_tool",
          "bash",
          "edit",
          "grep",
          "inactive_tool",
          "memory",
          "read",
        ]);
        session.dispose();

        const toolLess = yield* awaited(
          createSession(["read"], { noTools: "all", tools: ["+inactive_tool"] }, [inactiveTool]),
        );
        expect(toolLess.getActiveToolNames()).toEqual(["inactive_tool"]);
        toolLess.dispose();
      }),
    ));

  it("rejects invalid tool modifier options", () =>
    runTest(
      Effect.gen(function* () {
        yield* awaited(
          expect(createSession([], { tools: ["read", "+grep"] })).rejects.toThrow(
            "Invalid tools option: tool names cannot be mixed with +name or -name entries",
          ),
        );
        yield* awaited(
          expect(createSession([], { tools: ["-gr*"] })).rejects.toThrow(
            "Invalid tools option: +name and -name entries take exact tool names, not patterns: -gr*",
          ),
        );
      }),
    ));

  describe("reload", () => {
    const inactiveTool: InlineExtension = (msa) => {
      msa.registerTool({
        name: "inactive_tool",
        label: "Inactive Tool",
        description: "Extension tool registered inactive",
        parameters: Type.Object({}),
        execute: () =>
          runTest(awaited({ content: [{ type: "text" as const, text: "ok" }], details: {} })),
        defaultActive: false,
      });
    };

    const writeSettings = (settings: object) =>
      writeFileSync(joinPath(agentDir, "settings.json"), JSON.stringify(settings));

    function createFileSession(options: ToolOptions = {}) {
      return runTest(
        Effect.gen(function* () {
          const settingsManager = SettingsManager.create(tempDir, agentDir);
          const resourceLoader = new DefaultResourceLoader({
            cwd: tempDir,
            agentDir,
            settingsManager,
            extensionFactories: [inactiveTool],
          });
          yield* awaited(resourceLoader.reload());
          return yield* awaited(
            (yield* awaited(
              createAgentSession({
                cwd: tempDir,
                agentDir,
                model: getModel("anthropic", "claude-sonnet-4-5")!,
                settingsManager,
                sessionManager: SessionManager.inMemory(tempDir),
                resourceLoader,
                ...options,
              }),
            )).session,
          );
        }),
      );
    }

    it("activates only tools newly added to defaultTools", () =>
      runTest(
        Effect.gen(function* () {
          const session = yield* awaited(createFileSession());
          expect(session.getActiveToolNames()).toEqual(["read", "bash", "edit", "write", "memory"]);
          session.setActiveToolsByName(["read", "edit", "write"]);

          writeSettings({ defaultTools: ["+inactive_tool", "+grep"] });
          yield* awaited(session.reload());

          expect(session.getActiveToolNames().sort()).toEqual([
            "edit",
            "grep",
            "inactive_tool",
            "read",
            "write",
          ]);

          writeSettings({ defaultTools: ["-read"] });
          yield* awaited(session.reload());
          expect(session.getActiveToolNames().sort()).toEqual([
            "edit",
            "grep",
            "inactive_tool",
            "read",
            "write",
          ]);
          session.dispose();
        }),
      ));

    it("keeps tools removed by -name tool options removed on reload", () =>
      runTest(
        Effect.gen(function* () {
          writeSettings({ defaultTools: ["read"] });
          const session = yield* awaited(createFileSession({ tools: ["-bash", "+grep"] }));
          expect(session.getActiveToolNames()).toEqual(["read", "grep"]);

          writeSettings({ defaultTools: ["read", "bash", "inactive_tool"] });
          yield* awaited(session.reload());
          expect(session.getActiveToolNames().sort()).toEqual(["grep", "inactive_tool", "read"]);
          session.dispose();
        }),
      ));

    it("keeps explicit tool options on reload", () =>
      runTest(
        Effect.gen(function* () {
          const allowlisted = yield* awaited(createFileSession({ tools: ["read"] }));
          writeSettings({ defaultTools: ["+grep"] });
          yield* awaited(allowlisted.reload());
          expect(allowlisted.getActiveToolNames()).toEqual(["read"]);
          allowlisted.dispose();

          writeSettings({});
          const builtinless = yield* awaited(createFileSession({ noTools: "builtin" }));
          writeSettings({ defaultTools: ["+grep"] });
          yield* awaited(builtinless.reload());
          expect(builtinless.getActiveToolNames()).toEqual([]);
          builtinless.dispose();

          writeSettings({});
          const excluded = yield* awaited(createFileSession({ excludeTools: ["grep"] }));
          writeSettings({ defaultTools: ["+grep", "+inactive_tool"] });
          yield* awaited(excluded.reload());
          expect(excluded.getActiveToolNames().sort()).toEqual([
            "bash",
            "edit",
            "inactive_tool",
            "memory",
            "read",
            "write",
          ]);
          excluded.dispose();
        }),
      ));
  });

  describe("resume", () => {
    const extensionTools: InlineExtension = (msa) => {
      msa.registerTool({
        name: "inactive_tool",
        label: "Inactive Tool",
        description: "Extension tool registered inactive",
        parameters: Type.Object({}),
        execute: () =>
          runTest(awaited({ content: [{ type: "text" as const, text: "ok" }], details: {} })),
        defaultActive: false,
      });
      msa.registerTool({
        name: "active_tool",
        label: "Active Tool",
        description: "Extension tool registered active",
        parameters: Type.Object({}),
        execute: () =>
          runTest(awaited({ content: [{ type: "text" as const, text: "ok" }], details: {} })),
      });
    };

    function createRecordedSession(toolNames: string[]): SessionManager {
      const sessionManager = SessionManager.inMemory(tempDir);
      sessionManager.appendMessage({
        role: "system",
        content: "",
        toolsAdded: toolNames.map((name) => ({
          name,
          description: name,
          parameters: Type.Object({}),
        })),
        timestamp: currentTimeMillis(),
      });
      return sessionManager;
    }

    function resume(sessionManager: SessionManager, options: ToolOptions = {}) {
      return runTest(
        Effect.gen(function* () {
          const settingsManager = SettingsManager.inMemory();
          const resourceLoader = new DefaultResourceLoader({
            cwd: tempDir,
            agentDir,
            settingsManager,
            extensionFactories: [extensionTools],
          });
          yield* awaited(resourceLoader.reload());
          return yield* awaited(
            (yield* awaited(
              createAgentSession({
                cwd: tempDir,
                agentDir,
                model: getModel("anthropic", "claude-sonnet-4-5")!,
                settingsManager,
                sessionManager,
                resourceLoader,
                ...options,
              }),
            )).session,
          );
        }),
      );
    }

    it("restores the loadout the transcript records", () =>
      runTest(
        Effect.gen(function* () {
          const session = yield* awaited(
            resume(createRecordedSession(["read", "grep", "inactive_tool"])),
          );
          expect(session.getActiveToolNames().sort()).toEqual(["grep", "inactive_tool", "read"]);
          session.dispose();
        }),
      ));

    it("does not restore excluded tools", () =>
      runTest(
        Effect.gen(function* () {
          const session = yield* awaited(
            resume(createRecordedSession(["read", "grep", "inactive_tool"]), {
              excludeTools: ["inactive_tool"],
            }),
          );
          expect(session.getActiveToolNames().sort()).toEqual(["grep", "read"]);
          session.dispose();
        }),
      ));

    it("uses explicit tool options instead of the recorded loadout", () =>
      runTest(
        Effect.gen(function* () {
          const recorded = ["read", "grep", "inactive_tool"];

          const allowlisted = yield* awaited(
            resume(createRecordedSession(recorded), {
              tools: ["read", "write"],
            }),
          );
          expect(allowlisted.getActiveToolNames()).toEqual(["read", "write"]);
          allowlisted.dispose();

          const builtinless = yield* awaited(
            resume(createRecordedSession(recorded), { noTools: "builtin" }),
          );
          expect(builtinless.getActiveToolNames()).toEqual(["active_tool"]);
          builtinless.dispose();
        }),
      ));

    it("applies +name and -name tool options to the recorded loadout", () =>
      runTest(
        Effect.gen(function* () {
          const session = yield* awaited(
            resume(createRecordedSession(["read", "grep", "inactive_tool"]), {
              tools: ["-grep", "+write"],
            }),
          );
          expect(session.getActiveToolNames().sort()).toEqual(["inactive_tool", "read", "write"]);
          session.dispose();
        }),
      ));

    it("uses the default tools when the transcript records no loadout", () =>
      runTest(
        Effect.gen(function* () {
          const sessionManager = SessionManager.inMemory(tempDir);
          sessionManager.appendMessage({
            role: "user",
            content: "hi",
            timestamp: currentTimeMillis(),
          });
          const session = yield* awaited(resume(sessionManager));
          expect(session.getActiveToolNames().sort()).toEqual([
            "active_tool",
            "bash",
            "edit",
            "memory",
            "read",
            "write",
          ]);
          session.dispose();
        }),
      ));
  });

  it("applies through service-based session creation", () =>
    runTest(
      Effect.gen(function* () {
        const settingsManager = SettingsManager.inMemory({ defaultTools: ["ls"] });
        const services = yield* awaited(
          createAgentSessionServices({ cwd: tempDir, agentDir, settingsManager }),
        );
        const { session } = yield* awaited(
          createAgentSessionFromServices({
            services,
            sessionManager: SessionManager.inMemory(tempDir),
            model: getModel("anthropic", "claude-sonnet-4-5")!,
          }),
        );

        expect(
          session
            .getAllTools()
            .map((tool) => tool.name)
            .sort(),
        ).toEqual(["bash", "edit", "find", "grep", "ls", "memory", "powershell", "read", "write"]);
        expect(session.getActiveToolNames()).toEqual(["ls"]);
        session.dispose();
      }),
    ));
});

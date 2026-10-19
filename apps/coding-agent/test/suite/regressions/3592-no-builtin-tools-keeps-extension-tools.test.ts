import * as NodeServices from "@effect/platform-node/NodeServices";
import { getModel } from "@msa/ai/compat";
import { joinPath } from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  createAgentSessionFromServices,
  createAgentSessionServices,
} from "../../../src/core/agent-session-services.ts";
import { ORCHESTRATOR_TOOL_NAMES } from "../../../src/core/orchestrator/tool-names.ts";
import { DefaultResourceLoader } from "../../../src/core/resource-loader.ts";
import { createAgentSession } from "../../../src/core/sdk.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

let tempDir: string;

let agentDir: string;

function createSession(options?: { noTools?: "all" | "builtin"; tools?: string[] }) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const settingsManager = SettingsManager.create(tempDir, agentDir);
      const sessionManager = SessionManager.inMemory(tempDir);
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
                parameters: Type.Object({}),
                execute: () =>
                  Promise.resolve({
                    content: [{ type: "text", text: "ok" }],
                    details: {},
                  }),
              });
            });
          },
        ],
      });
      yield* Effect.promise(() => resourceLoader.reload());

      const { session } = yield* Effect.promise(() =>
        createAgentSession({
          cwd: tempDir,
          agentDir,
          model: getModel("anthropic-api", "claude-sonnet-4-5")!,
          settingsManager,
          sessionManager,
          resourceLoader,
          ...(options?.noTools === undefined ? {} : { noTools: options.noTools }),
          ...(options?.tools === undefined ? {} : { tools: options.tools }),
        }),
      );
      yield* Effect.promise(() => session.bindExtensions({}));
      return session;
    }),
  );
}

const keepsExtensionToolsActiveWhenBuilt = Effect.gen(function* () {
  const session = yield* Effect.promise(() => createSession({ noTools: "builtin" }));

  expect(
    session
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
      "write",
      ...ORCHESTRATOR_TOOL_NAMES,
    ].sort(),
  );
  expect(session.getActiveToolNames()).toEqual(["dynamic_tool"]);
  expect(session.systemPrompt).toContain("- dynamic_tool: Run dynamic test behavior");
  expect(session.systemPrompt).not.toContain("- read:");
  expect(session.systemPrompt).not.toContain("- bash:");
  session.dispose();
});

const stillDisablesAllToolsWhenNotools = Effect.gen(function* () {
  const session = yield* Effect.promise(() => createSession({ noTools: "all" }));

  expect(session.getAllTools()).toEqual([]);
  expect(session.getActiveToolNames()).toEqual([]);
  expect(session.systemPrompt).toContain("<tools>\n(none)\n");
  session.dispose();
});

const propagatesNotoolsThroughServiceBasedSession = Effect.gen(function* () {
  const settingsManager = SettingsManager.create(tempDir, agentDir);
  const sessionManager = SessionManager.inMemory(tempDir);
  const services = yield* Effect.promise(() =>
    createAgentSessionServices({
      cwd: tempDir,
      agentDir,
      settingsManager,
    }),
  );

  const { session } = yield* Effect.promise(() =>
    createAgentSessionFromServices({
      services,
      sessionManager,
      model: getModel("anthropic-api", "claude-sonnet-4-5")!,
      noTools: "builtin",
    }),
  );

  expect(session.getActiveToolNames()).toEqual([]);
  expect(session.systemPrompt).toContain("<tools>\n(none)\n");
  expect(session.systemPrompt).not.toContain("- read:");
  session.dispose();
});

describe("regression #3592: no-builtin-tools keeps extension tools enabled", () => {
  beforeEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        tempDir = yield* fs.makeTempDirectory({ prefix: `msa-no-builtin-tools-` });
        agentDir = joinPath(tempDir, "agent");
        yield* fs.makeDirectory(agentDir, { recursive: true });
      }),
    ),
  );
  afterEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        if (tempDir !== "" && (yield* fs.exists(tempDir))) {
          yield* fs.remove(tempDir, { recursive: true, force: true });
        }
      }),
    ),
  );
  it("keeps extension tools active when built-in defaults are disabled", () =>
    Effect.runPromise(keepsExtensionToolsActiveWhenBuilt));
  it("still disables all tools when noTools is all", () =>
    Effect.runPromise(stillDisablesAllToolsWhenNotools));
  it("propagates noTools through service-based session creation", () =>
    Effect.runPromise(propagatesNotoolsThroughServiceBasedSession));
});

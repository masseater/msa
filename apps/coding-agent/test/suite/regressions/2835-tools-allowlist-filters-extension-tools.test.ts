import * as NodeServices from "@effect/platform-node/NodeServices";
import { getModel } from "@msa/ai/compat";
import { joinPath } from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { DefaultResourceLoader } from "../../../src/core/resource-loader.ts";
import { createAgentSession } from "../../../src/core/sdk.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

let tempDir: string;

let agentDir: string;

function createSession(allowedToolNames?: string[]) {
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
          ...(allowedToolNames === undefined ? {} : { tools: allowedToolNames }),
        }),
      );
      yield* Effect.promise(() => session.bindExtensions({}));
      return session;
    }),
  );
}

const allowsOnlyExplicitlyListedBuiltIn = Effect.gen(function* () {
  const session = yield* Effect.promise(() => createSession(["read", "dynamic_tool"]));

  expect(
    session
      .getAllTools()
      .map((tool) => tool.name)
      .sort(),
  ).toEqual(["dynamic_tool", "read"]);
  expect(session.getActiveToolNames().sort()).toEqual(["dynamic_tool", "read"]);
  expect(session.systemPrompt).toContain("- read: Read file contents");
  expect(session.systemPrompt).toContain("- dynamic_tool: Run dynamic test behavior");
  expect(session.systemPrompt).not.toContain("- bash:");
  expect(session.systemPrompt).not.toContain("- edit:");
  session.dispose();
});

const disablesAllToolsWhenTheAllowlist = Effect.gen(function* () {
  const session = yield* Effect.promise(() => createSession([]));

  expect(session.getAllTools()).toEqual([]);
  expect(session.getActiveToolNames()).toEqual([]);
  expect(session.systemPrompt).toContain("<tools>\n(none)\n");
  expect(session.systemPrompt).not.toContain("dynamic_tool");
  session.dispose();
});

describe("regression #2835: tool allowlists filter extension tools", () => {
  beforeEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        tempDir = yield* fs.makeTempDirectory({ prefix: `msa-tools-filter-` });
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
  it("allows only explicitly listed built-in and extension tools", () =>
    Effect.runPromise(allowsOnlyExplicitlyListedBuiltIn));
  it("disables all tools when the allowlist is empty", () =>
    Effect.runPromise(disablesAllToolsWhenTheAllowlist));
});

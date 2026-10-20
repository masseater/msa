import * as NodeServices from "@effect/platform-node/NodeServices";
import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import DefaultResourceLoader from "../../../src/core/default-resource-loader.ts";
import sdk from "../../../src/core/sdk.ts";
import SessionManager from "../../../src/core/session-manager.ts";
import SettingsManager from "../../../src/core/settings-manager.ts";

const { createAgentSession } = sdk;

const { getModel } = compat;

const { joinPath } = testing;

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
        agentDir,
        cwd: tempDir,
        extensionFactories: [
          (msa) => {
            msa.on("session_start", () => {
              msa.registerTool({
                description: "Tool registered from session_start",
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
        ],
        settingsManager,
      });
      yield* Effect.promise(() => resourceLoader.reload());

      const { session } = yield* Effect.promise(() =>
        createAgentSession({
          agentDir,
          cwd: tempDir,
          model: getModel("anthropic-api", "claude-sonnet-4-5")!,
          resourceLoader,
          sessionManager,
          settingsManager,
          ...(allowedToolNames === undefined ? {} : { tools: allowedToolNames }),
        }),
      );
      yield* Effect.promise(() => session.extensions.binding.bindExtensions({}));
      return session;
    }),
  );
}

const allowsOnlyExplicitlyListedBuiltIn = Effect.gen(function* () {
  const session = yield* Effect.promise(() => createSession(["read", "dynamic_tool"]));

  expect(
    session.tools.registry
      .getAllTools()
      .map((tool) => tool.name)
      .sort(),
  ).toEqual(["dynamic_tool", "read"]);
  expect(session.tools.loadout.getActiveToolNames().sort()).toEqual(["dynamic_tool", "read"]);
  expect(session.tools.prompt.systemPrompt).toContain("- read: Read file contents");
  expect(session.tools.prompt.systemPrompt).toContain("- dynamic_tool: Run dynamic test behavior");
  expect(session.tools.prompt.systemPrompt).not.toContain("- bash:");
  expect(session.tools.prompt.systemPrompt).not.toContain("- edit:");
  session.dispose();
});

const disablesAllToolsWhenTheAllowlist = Effect.gen(function* () {
  const session = yield* Effect.promise(() => createSession([]));

  expect(session.tools.registry.getAllTools()).toEqual([]);
  expect(session.tools.loadout.getActiveToolNames()).toEqual([]);
  expect(session.tools.prompt.systemPrompt).toContain("<tools>\n(none)\n");
  expect(session.tools.prompt.systemPrompt).not.toContain("dynamic_tool");
  session.dispose();
});

const allowsOnlyExplicitlyListedBuiltInAnd = () =>
  Effect.runPromise(allowsOnlyExplicitlyListedBuiltIn);

const disablesAllToolsWhenTheAllowlistIs = () =>
  Effect.runPromise(disablesAllToolsWhenTheAllowlist);

const beforeEachHook = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      tempDir = yield* fs.makeTempDirectory({ prefix: `msa-tools-filter-` });
      agentDir = joinPath(tempDir, "agent");
      yield* fs.makeDirectory(agentDir, { recursive: true });
    }),
  );

const afterEachHook = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      if (tempDir !== "" && (yield* fs.exists(tempDir))) {
        yield* fs.remove(tempDir, { force: true, recursive: true });
      }
    }),
  );

describe("regression #2835: tool allowlists filter extension tools", () => {
  beforeEach(beforeEachHook);
  afterEach(afterEachHook);
  it(
    "allows only explicitly listed built-in and extension tools",
    allowsOnlyExplicitlyListedBuiltInAnd,
  );
  it("disables all tools when the allowlist is empty", disablesAllToolsWhenTheAllowlistIs);
});

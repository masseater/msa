import { tmpdir } from "node:os";

import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import DefaultResourceLoader from "../src/core/default-resource-loader.ts";
import sdk from "../src/core/sdk.ts";
import SessionManager from "../src/core/session-manager.ts";
import SettingsManager from "../src/core/settings-manager.ts";

const { createAgentSession } = sdk;

const { getModel } = compat;

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

const keepsCustomToolsActiveButOmitsThemSetup = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const settingsManager = yield* Effect.promise(() => SettingsManager.create(tempDir, agentDir));
    const sessionManager = SessionManager.inMemory();

    const resourceLoader = new DefaultResourceLoader({
      agentDir,
      cwd: tempDir,
      extensionFactories: [
        (msa) => {
          msa.on("session_start", () => {
            msa.registerTool({
              description: "Description should not appear in available tools",
              execute: () =>
                effectRunPromise(
                  awaited({
                    content: [{ text: "ok", type: "text" as const }],
                    details: {},
                  }),
                ),
              label: "Hidden Tool",
              name: "hidden_tool",
              parameters: Type.Object({}),
            });
          });
        },
      ],
      settingsManager,
    });
    return { resourceLoader, sessionManager, settingsManager };
  });

const keepsCustomToolsActiveButOmitsThem = () =>
  runTest(
    Effect.gen(function* () {
      const { resourceLoader, sessionManager, settingsManager } =
        yield* keepsCustomToolsActiveButOmitsThemSetup();
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

      yield* awaited(session.extensions.binding.bindExtensions({}));

      expect(session.tools.registry.getAllTools().map((tool) => tool.name)).toContain(
        "hidden_tool",
      );
      expect(session.tools.loadout.getActiveToolNames()).toContain("hidden_tool");
      expect(session.tools.prompt.systemPrompt).not.toContain("hidden_tool");
      expect(session.tools.prompt.systemPrompt).not.toContain(
        "Description should not appear in available tools",
      );

      session.dispose();
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = joinPath(
        tmpdir(),
        `msa-dynamic-tool-test-${currentTimeMillis()}-${randomSuffixSync()}`,
      );
      agentDir = joinPath(tempDir, "agent");
      yield* makeDirectory(agentDir);
    }),
  );

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      if (tempDir.length > 0 && (yield* pathExists(tempDir))) {
        yield* removePath(tempDir);
      }
    }),
  );

describe("AgentSession dynamic tool registration", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  it(
    "keeps custom tools active but omits them from available tools when promptSnippet is not provided",
    keepsCustomToolsActiveButOmitsThem,
  );
});

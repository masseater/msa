import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";

import { DefaultResourceLoader } from "../../../src/core/resource-loader.ts";
import { createAgentSession } from "../../../src/core/sdk.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";

const { getModel } = compat;

const { joinPath, makeDirectory, makeTempDir, removePath, runTest } = testing;

const dirs = { agentDir: "", tempDir: "" };

const prepareDirs = () =>
  runTest(
    Effect.gen(function* () {
      dirs.tempDir = yield* makeTempDir("msa-no-builtin-tools-");
      dirs.agentDir = joinPath(dirs.tempDir, "agent");
      yield* makeDirectory(dirs.agentDir);
    }),
  );

const cleanupDirs = () => runTest(dirs.tempDir === "" ? Effect.void : removePath(dirs.tempDir));

function createSession(options?: { noTools?: "all" | "builtin"; tools?: string[] }) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const settingsManager = SettingsManager.create(dirs.tempDir, dirs.agentDir);
      const sessionManager = SessionManager.inMemory(dirs.tempDir);
      const resourceLoader = new DefaultResourceLoader({
        agentDir: dirs.agentDir,
        cwd: dirs.tempDir,
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
          agentDir: dirs.agentDir,
          cwd: dirs.tempDir,
          model: getModel("anthropic-api", "claude-sonnet-4-5")!,
          resourceLoader,
          sessionManager,
          settingsManager,
          ...(options?.noTools === undefined ? {} : { noTools: options.noTools }),
          ...(options?.tools === undefined ? {} : { tools: options.tools }),
        }),
      );
      yield* Effect.promise(() => session.bindExtensions({}));
      return session;
    }),
  );
}

const regression3592Support = {
  cleanupDirs,
  createSession,
  dirs,
  prepareDirs,
};

export default regression3592Support;

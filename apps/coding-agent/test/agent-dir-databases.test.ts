import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, expect, it } from "vite-plus/test";

import config from "../src/config.ts";
import AuthStorage from "../src/core/auth-storage.ts";
import platform from "../src/core/platform/index.ts";
import SessionManager from "../src/core/session-manager.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import src from "../src/index.ts";

const { ModelRuntime, createAgentSession } = src;
const { getModel } = compat;
const { ENV_AGENT_DIR } = config;
const { deleteEnv, readEnv, writeEnv } = platform;
const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  pathExists,
  readDirectory,
  removePath,
  runTest,
} = testing;

const originalAgentDir = readEnv(ENV_AGENT_DIR);
const directories: string[] = [];

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      if (originalAgentDir === undefined) deleteEnv(ENV_AGENT_DIR);
      else writeEnv(ENV_AGENT_DIR, originalAgentDir);
      for (const directory of directories.splice(0)) yield* removePath(directory);
    }),
  ),
);

const tempDirectory = (name: string) =>
  Effect.gen(function* () {
    const directory = yield* makeTempDir(`msa-agent-dir-${name}-`);
    directories.push(directory);
    return directory;
  });

it("keeps the orchestrator and memory databases in the agent dir the session was given", () =>
  runTest(
    Effect.gen(function* () {
      const ambient = yield* tempDirectory("ambient");
      const given = yield* tempDirectory("given");
      const cwd = joinPath(given, "cwd");
      yield* makeDirectory(cwd);
      writeEnv(ENV_AGENT_DIR, ambient);
      const authStorage = AuthStorage.inMemory();
      const modelRuntime = yield* awaited(
        ModelRuntime.create({
          credentials: authStorage,
          modelsPath: joinPath(given, "models.json"),
        }),
      );

      const { session } = yield* awaited(
        createAgentSession({
          agentDir: given,
          cwd,
          model: getModel("anthropic-api", "claude-sonnet-4-5")!,
          modelRuntime,
          sessionManager: SessionManager.inMemory(cwd),
          settingsManager: SettingsManager.inMemory(),
        }),
      );
      yield* awaited(session.dispose());

      expect(yield* pathExists(joinPath(given, "orchestrator.db"))).toBe(true);
      expect(yield* pathExists(joinPath(given, "memory.db"))).toBe(true);
      expect(yield* readDirectory(ambient)).toEqual([]);
    }),
  ));

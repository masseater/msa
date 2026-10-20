import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultResourceLoader from "../src/core/default-resource-loader.ts";
import processEnv from "../src/core/process-env.ts";
import sdk from "../src/core/sdk.ts";
import SessionManager from "../src/core/session-manager.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import webToolsSupport from "./web-tools-support.ts";
const { createAgentSession } = sdk;
const { readEnv } = processEnv;

const { getModel } = compat;

const { fakeTreg } = webToolsSupport;

const { awaited, joinPath, makeDirectory, makeTempDir, pathExists, removePath, runTest } = testing;

let tempDir: string;

function createSession() {
  return runTest(
    Effect.gen(function* () {
      const agentDir = joinPath(tempDir, "agent");
      const settingsManager = SettingsManager.inMemory();
      const resourceLoader = new DefaultResourceLoader({
        agentDir,
        cwd: tempDir,
        settingsManager,
      });
      yield* awaited(resourceLoader.reload());
      const { session } = yield* awaited(
        createAgentSession({
          agentDir,
          cwd: tempDir,
          model: getModel("anthropic-api", "claude-sonnet-4-5")!,
          resourceLoader,
          sessionManager: SessionManager.inMemory(tempDir),
          settingsManager,
        }),
      );
      return yield* awaited(session);
    }),
  );
}

function activeTools() {
  return runTest(
    Effect.gen(function* () {
      return yield* awaited((yield* awaited(createSession())).getActiveToolNames());
    }),
  );
}

const activatesWebSearchAndWebFetchBy = () =>
  runTest(
    Effect.gen(function* () {
      yield* fakeTreg(joinPath(tempDir, "bin"), true);
      vi.stubEnv("PATH", `${joinPath(tempDir, "bin")}:${readEnv("PATH")}`);
      expect(yield* awaited(activeTools())).toEqual(
        expect.arrayContaining(["read", "bash", "edit", "write", "web_search", "web_fetch"]),
      );
    }),
  );

const leavesThemOutWhenTregIsNot = () =>
  runTest(
    Effect.gen(function* () {
      yield* fakeTreg(joinPath(tempDir, "bin"), false);
      vi.stubEnv("PATH", `${joinPath(tempDir, "bin")}:${readEnv("PATH")}`);
      vi.stubEnv("TREG_TOKEN", "");
      const tools = yield* awaited(activeTools());
      expect(tools).not.toContain("web_search");
      expect(tools).not.toContain("web_fetch");
    }),
  );

const addsThemToARunningSessionOnce = () =>
  runTest(
    Effect.gen(function* () {
      yield* fakeTreg(joinPath(tempDir, "bin"), false);
      vi.stubEnv("PATH", `${joinPath(tempDir, "bin")}:${readEnv("PATH")}`);
      vi.stubEnv("TREG_TOKEN", "");
      const session = yield* awaited(createSession());
      expect(session.getActiveToolNames()).not.toContain("web_search");
      yield* fakeTreg(joinPath(tempDir, "bin"), true);
      session.refreshExternalServiceTools();
      expect(session.getActiveToolNames()).toEqual(
        expect.arrayContaining(["read", "web_search", "web_fetch"]),
      );
    }),
  );

const beforeEachHook3 = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = yield* makeTempDir("msa-web-tools-");
      yield* makeDirectory(joinPath(tempDir, "agent"));
      yield* makeDirectory(joinPath(tempDir, "bin"));
    }),
  );

const afterEachHook2 = () =>
  runTest(
    Effect.gen(function* () {
      vi.unstubAllEnvs();
      if (yield* pathExists(tempDir)) yield* removePath(tempDir);
    }),
  );

describe("web tool registration", () => {
  beforeEach(beforeEachHook3);

  afterEach(afterEachHook2);

  it(
    "activates web_search and web_fetch by default when treg is signed in",
    activatesWebSearchAndWebFetchBy,
  );

  it("leaves them out when treg is not signed in", leavesThemOutWhenTregIsNot);

  it("adds them to a running session once treg is signed in", addsThemToARunningSessionOnce);
});

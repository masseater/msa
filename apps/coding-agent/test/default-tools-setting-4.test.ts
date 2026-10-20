import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import agentSessionServices from "../src/core/agent-session-services.ts";
import toolNames from "../src/core/orchestrator/tool-names.ts";
import SessionManager from "../src/core/session-manager.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import defaultToolsSettingSupport from "./default-tools-setting-support.ts";
const { createAgentSessionFromServices, createAgentSessionServices } = agentSessionServices;
const { ORCHESTRATOR_TOOL_NAMES } = toolNames;

const { getModel } = compat;

const { cleanupDirs, dirs, prepareDirs } = defaultToolsSettingSupport;

const { awaited, runTest } = testing;

const appliesThroughServiceBasedSessionCreation = () =>
  runTest(
    Effect.gen(function* () {
      const settingsManager = SettingsManager.inMemory({ defaultTools: ["ls"] });
      const services = yield* awaited(
        createAgentSessionServices({ agentDir: dirs.agentDir, cwd: dirs.tempDir, settingsManager }),
      );
      const { session } = yield* awaited(
        createAgentSessionFromServices({
          model: getModel("anthropic-api", "claude-sonnet-4-5")!,
          services,
          sessionManager: SessionManager.inMemory(dirs.tempDir),
        }),
      );

      expect(
        session
          .getAllTools()
          .map((tool) => tool.name)
          .sort(),
      ).toEqual(
        [
          "bash",
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
      expect(session.getActiveToolNames()).toEqual(["ls"]);
      session.dispose();
    }),
  );

describe("defaultTools setting", () => {
  beforeEach(prepareDirs);

  afterEach(cleanupDirs);

  it("applies through service-based session creation", appliesThroughServiceBasedSessionCreation);
});

import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import toolNamesModule from "../src/core/orchestrator/tool-names.ts";
import type sdkTypes from "../src/core/sdk.types.ts";
import SessionManager from "../src/core/session-manager.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import defaultToolsSettingSupport from "./default-tools-setting-support.ts";
const { ORCHESTRATOR_TOOL_NAMES } = toolNamesModule;

const { cleanupDirs, dirs, prepareDirs, resumeSession } = defaultToolsSettingSupport;

const { awaited, currentTimeMillis, runTest } = testing;

const extensionTools: sdkTypes.InlineExtension = (msa) => {
  msa.registerTool({
    defaultActive: false,
    description: "Extension tool registered inactive",
    execute: () =>
      runTest(awaited({ content: [{ text: "ok", type: "text" as const }], details: {} })),
    label: "Inactive Tool",
    name: "inactive_tool",
    parameters: Type.Object({}),
  });
  msa.registerTool({
    description: "Extension tool registered active",
    execute: () =>
      runTest(awaited({ content: [{ text: "ok", type: "text" as const }], details: {} })),
    label: "Active Tool",
    name: "active_tool",
    parameters: Type.Object({}),
  });
};

function createRecordedSession(toolNames: string[]): sessionManagerTypes.SessionManager {
  const sessionManager = SessionManager.inMemory(dirs.tempDir);
  sessionManager.appendMessage({
    content: "",
    role: "system",
    timestamp: currentTimeMillis(),
    toolsAdded: toolNames.map((name) => ({
      description: name,
      name,
      parameters: Type.Object({}),
    })),
  });
  return sessionManager;
}

const resume = (
  sessionManager: sessionManagerTypes.SessionManager,
  options: Parameters<typeof resumeSession>[1] = {},
) => resumeSession(sessionManager, options, [extensionTools]);

const restoresTheLoadoutTheTranscriptRecords = () =>
  runTest(
    Effect.gen(function* () {
      const session = yield* awaited(
        resume(createRecordedSession(["read", "grep", "inactive_tool"])),
      );
      expect(session.getActiveToolNames().sort()).toEqual(["grep", "inactive_tool", "read"]);
      session.dispose();
    }),
  );

const doesNotRestoreExcludedTools = () =>
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
  );

const usesExplicitToolOptionsInsteadOfThe = () =>
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
  );

const appliesNameAndNameToolOptionsTo2 = () =>
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
  );

const usesTheDefaultToolsWhenTheTranscript = () =>
  runTest(
    Effect.gen(function* () {
      const sessionManager = SessionManager.inMemory(dirs.tempDir);
      sessionManager.appendMessage({
        content: "hi",
        role: "user",
        timestamp: currentTimeMillis(),
      });
      const session = yield* awaited(resume(sessionManager));
      expect(session.getActiveToolNames().sort()).toEqual(
        [
          "active_tool",
          "bash",
          "edit",
          "memory",
          "model_policy",
          "model_upgrade",
          "pr_watch",
          "read",
          "write",
          ...ORCHESTRATOR_TOOL_NAMES,
        ].sort(),
      );
      session.dispose();
    }),
  );

describe("defaultTools setting", () => {
  beforeEach(prepareDirs);

  afterEach(cleanupDirs);

  describe("resume", () => {
    it("restores the loadout the transcript records", restoresTheLoadoutTheTranscriptRecords);

    it("does not restore excluded tools", doesNotRestoreExcludedTools);

    it(
      "uses explicit tool options instead of the recorded loadout",
      usesExplicitToolOptionsInsteadOfThe,
    );

    it(
      "applies +name and -name tool options to the recorded loadout",
      appliesNameAndNameToolOptionsTo2,
    );

    it(
      "uses the default tools when the transcript records no loadout",
      usesTheDefaultToolsWhenTheTranscript,
    );
  });
});

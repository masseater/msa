import ai from "@msa/ai";
import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import sdk from "../src/core/sdk.ts";
import SessionManager from "../src/core/session-manager.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import systemPromptModule from "../src/core/system-prompt.ts";
import harnessModule from "./suite/harness.ts";
const { createAgentSession } = sdk;
const { buildSystemPromptSections, buildSystemPromptState, diffSystemPromptSections } =
  systemPromptModule;

const { fauxAssistantMessage, getCurrentSystemMessage, getSystemMessageText } = ai;
const { getModel } = compat;

const { createHarness } = harnessModule;

const { awaited, joinPath, makeTempDir, removePath, runTest } = testing;

const declaresThePromptAndToolsOnceAnd = () =>
  runTest(
    Effect.gen(function* () {
      const harness = yield* awaited(createHarness());
      try {
        harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
        yield* awaited(harness.session.prompt("one"));
        yield* awaited(harness.session.prompt("two"));
        const systemEntries = harness.sessionManager
          .getEntries()
          .filter((entry) => entry.type === "message" && entry.message.role === "system");
        expect(systemEntries).toHaveLength(1);
        expect(harness.session.messages.map((message) => message.role)).toEqual([
          "system",
          "user",
          "assistant",
          "user",
          "assistant",
        ]);
        const head = harness.session.messages[0];
        if (head?.role !== "system") throw new Error("expected system message");
        expect(head.content).toBe("");
        expect(Object.keys(head.sections ?? {})).toEqual([
          "preamble",
          "tools",
          "rules",
          "docs",
          "cwd",
        ]);
        expect(head.toolsAdded?.map((tool) => tool.name)).toEqual([
          "read",
          "bash",
          "edit",
          "write",
          "memory",
          "pr_watch",
          "model_policy",
          "model_upgrade",
        ]);
        expect(getSystemMessageText(head)).toBe(harness.session.systemPrompt);
      } finally {
        harness.cleanup();
      }
    }),
  );

const opensATranscriptWithoutASystemMessage = () =>
  runTest(
    Effect.gen(function* () {
      const tempDir = yield* makeTempDir("msa-system-prompt-migration-");
      try {
        const sessionManager = SessionManager.inMemory(tempDir);
        sessionManager.appendMessage({ content: "existing", role: "user", timestamp: 1 });
        const created = yield* awaited(
          createAgentSession({
            agentDir: joinPath(tempDir, "agent"),
            cwd: tempDir,
            model: getModel("anthropic-api", "claude-sonnet-4-5")!,
            noTools: "all",
            sessionManager,
            settingsManager: SettingsManager.inMemory(),
          }),
        );
        try {
          expect(created.session.messages.map((message) => message.role)).toEqual(["user"]);
          expect(
            sessionManager.buildSessionContext().messages.map((message) => message.role),
          ).toEqual(["user"]);
          expect(getCurrentSystemMessage(created.session.messages)).toBeUndefined();
        } finally {
          created.session.dispose();
        }
      } finally {
        yield* removePath(tempDir);
      }
    }),
  );

const diffsSectionsIntoAPatch = () => {
  const previous = buildSystemPromptSections({
    cwd: "/tmp",
    sections: { plan_mode: "Plan only." },
  });
  const current = buildSystemPromptSections({
    cwd: "/tmp",
    sections: { plan_mode: "Implementation allowed." },
  });
  expect(diffSystemPromptSections(previous, current)).toEqual({
    plan_mode: "<plan_mode>\nImplementation allowed.\n</plan_mode>",
  });
  expect(diffSystemPromptSections(previous, previous)).toBeUndefined();
  expect(diffSystemPromptSections(previous, buildSystemPromptSections({ cwd: "/tmp" }))).toEqual({
    plan_mode: null,
  });
};

const keepsThePreambleUntaggedAndReplacesIt = () => {
  const previous = buildSystemPromptSections({ customPrompt: "You are A.", cwd: "/tmp" });
  const current = buildSystemPromptSections({ customPrompt: "You are B.", cwd: "/tmp" });
  expect(previous["preamble"]).toBe("You are A.");
  expect(diffSystemPromptSections(previous, current)).toEqual({ preamble: "You are B." });

  expect(buildSystemPromptState({ cwd: "/tmp", forceSystemPrompt: "Exact prompt." })).toEqual({
    content: "Exact prompt.",
  });
  expect(buildSystemPromptState({ cwd: "/tmp" })).toEqual({
    content: "",
    sections: buildSystemPromptSections({ cwd: "/tmp" }),
  });
  expect(() => buildSystemPromptSections({ cwd: "/tmp", sections: { preamble: "x" } })).toThrow(
    "Invalid system prompt section name",
  );
};

describe("system prompt updates", () => {
  test(
    "declares the prompt and tools once and reuses them across resume",
    declaresThePromptAndToolsOnceAnd,
  );

  test(
    "opens a transcript without a system message and declares the prompt on the first request",
    opensATranscriptWithoutASystemMessage,
  );

  test("diffs sections into a patch", diffsSectionsIntoAPatch);

  test(
    "keeps the preamble untagged and replaces it like any section",
    keepsThePreambleUntaggedAndReplacesIt,
  );
});

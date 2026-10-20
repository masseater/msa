import type { AssistantMessage, ToolResultMessage } from "@msa/ai/compat";
import { getModel } from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { defineTool } from "../src/core/extensions/types.ts";
import { serializeSessionBranch } from "../src/core/session-export.ts";
import { SessionManager, SettingsManager, createAgentSession } from "../src/index.ts";
import { createShareTrailingEntries } from "../src/modes/interactive/session-share.ts";
import utilities from "./utilities.ts";

const { assistantMsg, userMsg } = utilities;

const {
  awaited,
  currentTimeMillis,
  joinPath,
  makeTempDir,
  readTextFile,
  removePath,
  runTest,
  writeTextFile,
} = testing;

const tempDirs: string[] = [];

type ShareEntry = {
  id: string;
  data?: { systemPrompt?: string; tools?: Array<Record<string, unknown>> };
};

const shareTool = defineTool({
  description: "Render a value for sharing",
  execute: () =>
    Promise.resolve({ content: [{ text: "done", type: "text" as const }], details: {} }),
  label: "Share Tool",
  name: "share_tool",
  parameters: Type.Object({ value: Type.String({ description: "Value to render" }) }),
});

const createShareSession = (tempDir: string, sessionManager: SessionManager) =>
  awaited(
    createAgentSession({
      agentDir: joinPath(tempDir, "agent"),
      customTools: [shareTool],
      cwd: tempDir,
      model: getModel("anthropic-api", "claude-sonnet-4-5")!,
      sessionManager,
      settingsManager: SettingsManager.inMemory(),
      tools: ["share_tool"],
    }),
  );

const appendToolTurn = (sessionManager: SessionManager) => {
  const userId = sessionManager.appendMessage(userMsg("hello"));
  const assistant: AssistantMessage = {
    ...assistantMsg(""),
    content: [
      {
        arguments: { value: "example" },
        id: "call-1",
        name: "share_tool",
        type: "toolCall" as const,
      },
    ],
    stopReason: "toolUse",
  };
  const assistantId = sessionManager.appendMessage(assistant);
  const result: ToolResultMessage = {
    content: [{ text: "done", type: "text" as const }],
    details: {},
    isError: false,
    role: "toolResult",
    timestamp: currentTimeMillis(),
    toolCallId: "call-1",
    toolName: "share_tool",
  };
  return [userId, assistantId, sessionManager.appendMessage(result)] as const;
};

const readJsonl = (path: string) =>
  Effect.map(readTextFile(path), (text) =>
    text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  );

const expectShareEntry = (shareEntry: ShareEntry, resultId: string, systemPrompt: string) => {
  expect(shareEntry).toMatchObject({
    customType: "msa.share",
    parentId: resultId,
    timestamp: expect.any(String),
    type: "custom" as const,
  });
  expect(shareEntry.data?.systemPrompt).toBe(systemPrompt);
  expect(shareEntry.data?.tools).toEqual([
    expect.objectContaining({ description: "Render a value for sharing", name: "share_tool" }),
  ]);
  expect(shareEntry.data).not.toHaveProperty("renderedTools");
  expect(shareEntry.data).not.toHaveProperty("theme");
  expect(shareEntry.data).not.toHaveProperty("version");
};

const addsPresentationDataWithoutChangingConversationIds = Effect.gen(function* () {
  const tempDir = yield* makeTempDir("msa-jsonl-share-");
  tempDirs.push(tempDir);
  const sessionManager = SessionManager.inMemory(tempDir);
  const { session } = yield* createShareSession(tempDir, sessionManager);
  try {
    const turnIds = appendToolTurn(sessionManager);
    const originalEntryIds = sessionManager.getBranch().map((entry) => entry.id);

    const normalPath = joinPath(tempDir, "normal.jsonl");
    session.exportToJsonl(normalPath);
    const normalRecords = yield* readJsonl(normalPath);
    expect(
      normalRecords.some(
        (record) => record["type"] === "custom" && record["customType"] === "msa.share",
      ),
    ).toBe(false);

    const sharePath = joinPath(tempDir, "share.jsonl");
    yield* writeTextFile(
      sharePath,
      serializeSessionBranch(sessionManager, (parentId, timestamp) =>
        createShareTrailingEntries(session, parentId, timestamp),
      ),
    );
    const records = yield* readJsonl(sharePath);
    const conversationRecords = records.slice(1, -1);
    expect(conversationRecords.map((record) => record["id"])).toEqual(originalEntryIds);
    expect(conversationRecords.map((record) => record["parentId"])).toEqual([
      null,
      ...originalEntryIds.slice(0, -1),
    ]);
    expect(conversationRecords.slice(-3).map((record) => record["id"])).toEqual([...turnIds]);

    const shareEntry = records.at(-1) as ShareEntry;
    expectShareEntry(shareEntry, turnIds[2], session.state.systemPrompt);

    const imported = SessionManager.open(sharePath);
    expect(imported.getLeafId()).toBe(shareEntry.id);
    expect(imported.buildSessionContext().messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
    ]);
  } finally {
    session.dispose();
  }
});

const afterEachHook = Effect.gen(function* () {
  for (const tempDir of tempDirs.splice(0)) {
    yield* removePath(tempDir);
  }
});

describe("JSONL share export", () => {
  afterEach(() => runTest(afterEachHook));

  it("adds presentation data without changing conversation IDs or links", () =>
    runTest(addsPresentationDataWithoutChangingConversationIds));
});

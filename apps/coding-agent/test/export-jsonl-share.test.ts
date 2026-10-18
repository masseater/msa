import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import type { AssistantMessage, ToolResultMessage } from "@msa/ai/compat";
import { getModel } from "@msa/ai/compat";
import {
  awaited,
  runTest,
  currentTimeMillis,
  readTextFile,
  writeTextFile,
  joinPath,
} from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { defineTool } from "../src/core/extensions/types.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { serializeSessionBranch } from "../src/core/session-export.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createShareTrailingEntries } from "../src/modes/interactive/session-share.ts";
import { assistantMsg, userMsg } from "./utilities.ts";

describe("JSONL share export", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("adds presentation data without changing conversation IDs or links", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const tempDir = mkdtempSync(joinPath(tmpdir(), "msa-jsonl-share-"));
        tempDirs.push(tempDir);
        const sessionManager = SessionManager.inMemory(tempDir);
        const { session } = yield* awaited(
          createAgentSession({
            cwd: tempDir,
            agentDir: joinPath(tempDir, "agent"),
            model: getModel("anthropic", "claude-sonnet-4-5")!,
            settingsManager: SettingsManager.inMemory(),
            sessionManager,
            tools: ["share_tool"],
            customTools: [
              defineTool({
                name: "share_tool",
                label: "Share Tool",
                description: "Render a value for sharing",
                parameters: Type.Object({ value: Type.String({ description: "Value to render" }) }),
                execute: () =>
                  effectRunPromise(
                    awaited({ content: [{ type: "text" as const, text: "done" }], details: {} }),
                  ),
              }),
            ],
          }),
        );

        try {
          const userId = sessionManager.appendMessage(userMsg("hello"));
          const assistant: AssistantMessage = {
            ...assistantMsg(""),
            content: [
              {
                type: "toolCall" as const,
                id: "call-1",
                name: "share_tool",
                arguments: { value: "example" },
              },
            ],
            stopReason: "toolUse",
          };
          const assistantId = sessionManager.appendMessage(assistant);
          const result: ToolResultMessage = {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "share_tool",
            content: [{ type: "text" as const, text: "done" }],
            details: {},
            isError: false,
            timestamp: currentTimeMillis(),
          };
          const resultId = sessionManager.appendMessage(result);
          const originalEntryIds = sessionManager.getBranch().map((entry) => entry.id);

          const normalPath = joinPath(tempDir, "normal.jsonl");
          session.exportToJsonl(normalPath);
          const normalRecords = (yield* readTextFile(normalPath))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as Record<string, unknown>);
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
          const records = (yield* readTextFile(sharePath))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as Record<string, unknown>);
          const conversationRecords = records.slice(1, -1);
          expect(conversationRecords.map((record) => record["id"])).toEqual(originalEntryIds);
          expect(conversationRecords.map((record) => record["parentId"])).toEqual([
            null,
            ...originalEntryIds.slice(0, -1),
          ]);
          expect(conversationRecords.slice(-3).map((record) => record["id"])).toEqual([
            userId,
            assistantId,
            resultId,
          ]);

          const shareEntry = records.at(-1) as {
            id: string;
            data?: {
              systemPrompt?: string;
              tools?: Array<Record<string, unknown>>;
            };
          };
          expect(shareEntry).toMatchObject({
            type: "custom" as const,
            customType: "msa.share",
            parentId: resultId,
            timestamp: expect.any(String),
          });
          expect(shareEntry.data?.systemPrompt).toBe(session.state.systemPrompt);
          expect(shareEntry.data?.tools).toEqual([
            expect.objectContaining({
              name: "share_tool",
              description: "Render a value for sharing",
            }),
          ]);
          expect(shareEntry.data).not.toHaveProperty("renderedTools");
          expect(shareEntry.data).not.toHaveProperty("theme");
          expect(shareEntry.data).not.toHaveProperty("version");

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
      }),
    ));
});

import testing from "@msa/testing";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import SessionManager from "../../src/core/session-manager.ts";
import utilities from "../utilities.ts";
const { assistantMsg, readSessionFileRoles, userMsg } = utilities;

const { currentTimeMillis, makeDirectory, makeTempDir, pathExists, removePath, runTest } = testing;

const preservesToolAndSummaryUsageAcross = () =>
  runTest(
    Effect.gen(function* () {
      const tempDir = yield* makeTempDir(`session-usage-roundtrip-`);
      yield* makeDirectory(tempDir);

      try {
        const session = SessionManager.create(tempDir, tempDir);
        const rootId = session.appendMessage(userMsg("question"));
        session.appendMessage(assistantMsg("answer"));
        const usage = {
          cacheRead: 30,
          cacheWrite: 40,
          cost: { cacheRead: 0.3, cacheWrite: 0.4, input: 0.1, output: 0.2, total: 1 },
          input: 10,
          output: 20,
          totalTokens: 100,
        };
        session.appendMessage({
          content: [{ text: "result", type: "text" }],
          isError: false,
          role: "toolResult",
          timestamp: currentTimeMillis(),
          toolCallId: "call-1",
          toolName: "nested-model",
          usage,
        });
        session.appendCompaction("summary", rootId, 100, undefined, false, usage);
        session.branchWithSummary(rootId, "branch summary", undefined, false, usage);

        const file = session.getSessionFile();
        expect(file).toBeDefined();
        const reopened = SessionManager.open(file!, tempDir);
        expect(reopened.getEntries()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "compaction", usage }),
            expect.objectContaining({ type: "branch_summary", usage }),
            expect.objectContaining({
              message: expect.objectContaining({ role: "toolResult", usage }),
              type: "message",
            }),
          ]),
        );
      } finally {
        yield* removePath(tempDir);
      }
    }),
  );
const writesFileImmediatelyWhenForkingAt = () =>
  runTest(
    Effect.gen(function* () {
      const tempDir = yield* makeTempDir(`session-fork-with-user-`);
      yield* makeDirectory(tempDir);

      try {
        const session = SessionManager.create(tempDir, tempDir);
        const id1 = session.appendMessage(userMsg("first question"));
        session.appendMessage(assistantMsg("first answer"));

        const newFile = session.createBranchedSession(id1);
        expect(yield* pathExists(newFile!)).toBe(true);

        session.appendMessage(assistantMsg("new answer"));
        expect(yield* Effect.promise(() => readSessionFileRoles(newFile!))).toEqual([
          "session",
          "user",
          "assistant",
        ]);
      } finally {
        yield* removePath(tempDir);
      }
    }),
  );

const treeTraversalCases3 = {
  preservesToolAndSummaryUsageAcross,
  writesFileImmediatelyWhenForkingAt,
};

export default treeTraversalCases3;

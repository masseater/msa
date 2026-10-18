import { currentTimeMillis } from "@msa/testing";
import { Effect } from "effect";
import { expect } from "vite-plus/test";
import { SessionManager } from "../../src/core/session-manager.ts";
import { assistantMsg, readSessionFileRoles, userMsg } from "../utilities.ts";
import { fs, runtime } from "./tree-traversal-cases-1.ts";

export const preservesToolAndSummaryUsageAcross = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const tempDir = yield* fs.makeTempDirectory({ prefix: `session-usage-roundtrip-` });
      yield* fs.makeDirectory(tempDir, { recursive: true });

      try {
        const session = SessionManager.create(tempDir, tempDir);
        const rootId = session.appendMessage(userMsg("question"));
        session.appendMessage(assistantMsg("answer"));
        const usage = {
          input: 10,
          output: 20,
          cacheRead: 30,
          cacheWrite: 40,
          totalTokens: 100,
          cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
        };
        session.appendMessage({
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "nested-model",
          content: [{ type: "text", text: "result" }],
          isError: false,
          usage,
          timestamp: currentTimeMillis(),
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
              type: "message",
              message: expect.objectContaining({ role: "toolResult", usage }),
            }),
          ]),
        );
      } finally {
        yield* fs.remove(tempDir, { recursive: true, force: true });
      }
    }),
  );
export const writesFileImmediatelyWhenForkingAt = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const tempDir = yield* fs.makeTempDirectory({ prefix: `session-fork-with-user-` });
      yield* fs.makeDirectory(tempDir, { recursive: true });

      try {
        const session = SessionManager.create(tempDir, tempDir);
        const id1 = session.appendMessage(userMsg("first question"));
        session.appendMessage(assistantMsg("first answer"));

        const newFile = session.createBranchedSession(id1);
        expect(yield* fs.exists(newFile!)).toBe(true);

        session.appendMessage(assistantMsg("new answer"));
        expect(yield* Effect.promise(() => readSessionFileRoles(newFile!))).toEqual([
          "session",
          "user",
          "assistant",
        ]);
      } finally {
        yield* fs.remove(tempDir, { recursive: true, force: true });
      }
    }),
  );

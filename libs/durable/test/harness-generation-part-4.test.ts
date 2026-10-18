import { LiveDoc, UserEntry } from "@msa/durable";
import { GenerationTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type { SessionImpl } from "../src/session/session.ts";
import { live } from "./harness-generation-support.ts";
import { chatSetup, openChat, awaited, context } from "./support.ts";

const orphansBlockedRun = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const { taskId, submissionId } = yield* awaited(
    (harness as unknown as SessionImpl).commitWith(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const entry = yield* awaited(
              tx.appendEntry(UserEntry, root.id, {
                model: [{ role: "user", content: "hi", timestamp: 1 }],
              }),
            );
            const submission = yield* awaited(
              tx.createSubmission({
                conversationId: root.id,
                type: "input",
                status: "placed",
                entry: entry.id,
              }),
            );
            const taskId = yield* awaited(
              tx.createTask(
                { definition: { ...GenerationTask.definition, version: 2 } },
                {},
                { ownership: { kind: "conversation" }, conversationId: root.id },
              ),
            );
            (yield* awaited(tx.doc(LiveDoc, root.id))).run = {
              taskId,
              inputs: [submission.id],
            };
            return { taskId, submissionId: submission.id };
          }),
        ),
      context,
    ),
  );
  harness.resume();
  yield* awaited(
    expect(
      root.submit({ type: "input", content: "busy", whenBusy: "reject" }, context),
    ).rejects.toThrow("is busy"),
  );
  expect(yield* awaited(harness.abortTask(taskId, context))).toBe("marked");
  expect((yield* awaited(harness.waitForTask(taskId, context))).state.outcome).toEqual({
    status: "orphaned",
    reason: "task_too_old",
  });
  expect(
    yield* awaited((yield* awaited(harness.submission(submissionId, context)))!.status(context)),
  ).toMatchObject({
    status: "unanswered",
    reason: "task_too_old",
  });
  expect(yield* awaited(live(harness, root))).toEqual({});
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("orphans a blocked run task with full run cleanup", () =>
    Effect.runPromise(orphansBlockedRun));
});

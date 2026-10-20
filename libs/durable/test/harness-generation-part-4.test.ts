import { LiveDoc, UserEntry } from "@msa/durable";
import { GenerationTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type { SessionImpl } from "../src/session/session.ts";
import harnessGenerationSupport from "./harness-generation-support.ts";
import support from "./support.ts";

const { live } = harnessGenerationSupport;
const { awaited, chatSetup, context, openChat } = support;

const orphansBlockedRunStep1 = Effect.gen(function* () {
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
                model: [{ content: "hi", role: "user", timestamp: 1 }],
              }),
            );
            const submission = yield* awaited(
              tx.createSubmission({
                conversationId: root.id,
                entry: entry.id,
                status: "placed",
                type: "input",
              }),
            );
            const taskIdInner = yield* awaited(
              tx.createTask(
                { definition: { ...GenerationTask.definition, version: 2 } },
                {},
                { conversationId: root.id, ownership: { kind: "conversation" } },
              ),
            );
            (yield* awaited(tx.doc(LiveDoc, root.id))).run = {
              inputs: [submission.id],
              taskId: taskIdInner,
            };
            return { submissionId: submission.id, taskId: taskIdInner };
          }),
        ),
      context,
    ),
  );
  harness.resume();
  return { harness, root, submissionId, taskId };
});

const orphansBlockedRun = Effect.gen(function* () {
  const { harness, root, taskId, submissionId } = yield* orphansBlockedRunStep1;
  yield* awaited(
    expect(
      root.submit({ content: "busy", type: "input", whenBusy: "reject" }, context),
    ).rejects.toThrow("is busy"),
  );
  expect(yield* awaited(harness.abortTask(taskId, context))).toBe("marked");
  expect((yield* awaited(harness.waitForTask(taskId, context))).state.outcome).toEqual({
    reason: "task_too_old",
    status: "orphaned",
  });
  expect(
    yield* awaited((yield* awaited(harness.submission(submissionId, context)))!.status(context)),
  ).toMatchObject({
    reason: "task_too_old",
    status: "unanswered",
  });
  expect(yield* awaited(live(harness, root))).toEqual({});
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("orphans a blocked run task with full run cleanup", () =>
    Effect.runPromise(orphansBlockedRun));
});

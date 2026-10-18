import { fauxAssistantMessage } from "@msa/ai";
import { AssistantEntry, LiveDoc } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { runTaskId, checkpoint } from "./harness-generation-recovery-cases.ts";
import { open, directories, sqlitePath } from "./harness-generation-recovery-support.ts";
import { chatSetup, textOf, waitFor, awaited, removeDir, context } from "./support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const resumesPollingDeferred = Effect.gen(function* () {
  const path = yield* sqlitePath();
  const setup = chatSetup({ deferred: { pollAfterMs: 60_000 } });
  let now = 1_000;
  setup.now = () => now;
  setup.faux.setResponses([fauxAssistantMessage("deferred answer")]);
  let opened = yield* open(path, setup);
  opened.harness.resume();
  setup.settings.stream = { deferred: true };
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "hi" }, context))).id;
  yield* waitFor(
    Effect.gen(function* () {
      const live = yield* awaited(opened.harness.snapshot(LiveDoc, opened.root.id, context));
      return live?.generation?.deferred !== undefined;
    }),
  );
  const taskId = yield* runTaskId(opened.harness);
  yield* awaited(opened.harness.close(context));

  opened = yield* open(path, setup);
  expect(yield* checkpoint(opened.harness, taskId)).toMatchObject({
    phase: "poll",
    attempt: 1,
    pollAt: 61_000,
  });
  now = 61_000;
  opened.harness.resume();
  const settled = yield* awaited(
    (yield* awaited(opened.harness.submission(id, context)))!.wait(context),
  );
  if (settled.status !== "done" || settled.type !== "input")
    throw new Error(`Unexpected ${settled.status}`);
  const answer = yield* awaited(
    opened.root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context),
  );
  expect(textOf(answer?.model?.[0])).toBe("deferred answer");
  expect(setup.faux.state.deferredFetchCount).toBe(1);
  yield* awaited(opened.harness.close(context));
});

describe("generation recovery", () => {
  it("resumes polling a deferred response after reopen", () =>
    Effect.runPromise(resumesPollingDeferred));
});

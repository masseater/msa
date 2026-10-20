import { createModels, fauxAssistantMessage } from "@msa/ai";
import { AssistantEntry, LiveDoc } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import harnessGenerationRecoverySupport from "./harness-generation-recovery-support.ts";
import harnessSupport from "./harness-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";

const { chatSetup, textOf, unanswered, waitFor } = chatSupport;
const { awaited } = effectSupport;
const { directories, open, sqlitePath } = harnessGenerationRecoverySupport;
const { addSection } = harnessSupport;
const { removeDir } = platformSupport;
const { context } = sessionSupport;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const failsNoModelStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup({ deferred: { pollAfterMs: 60_000 } });
  const busy = unanswered();
  setup.faux.setResponses([busy.step, fauxAssistantMessage("deferred")]);
  return { busy, path, runPromise, setup };
});

const failsNoModel = Effect.gen(function* () {
  const { path, setup, busy } = yield* failsNoModelStep1;
  let opened = yield* open(path, setup);
  opened.harness.resume();
  const requesting = (yield* awaited(
    opened.root.submit({ content: "one", type: "input" }, context),
  )).id;
  yield* awaited(busy.reached);
  yield* awaited(opened.harness.close(context));

  const empty: ReturnType<typeof chatSetup> = { ...setup, models: createModels() };
  opened = yield* open(path, empty);
  opened.harness.resume();
  expect(
    yield* awaited((yield* awaited(opened.harness.submission(requesting, context)))!.wait(context)),
  ).toMatchObject({
    reason: "no_model",
    status: "unanswered",
  });
  yield* awaited(opened.harness.close(context));

  opened = yield* open(path, setup);
  setup.settings.stream = { deferred: true };
  opened.harness.resume();
  const polling = (yield* awaited(opened.root.submit({ content: "two", type: "input" }, context)))
    .id;
  yield* waitFor(
    Effect.gen(function* () {
      const live = yield* awaited(opened.harness.snapshot(LiveDoc, opened.root.id, context));
      return live?.generation?.deferred !== undefined;
    }),
  );
  yield* awaited(opened.harness.close(context));

  opened = yield* open(path, empty);
  opened.harness.resume();
  expect(
    yield* awaited((yield* awaited(opened.harness.submission(polling, context)))!.wait(context)),
  ).toMatchObject({
    reason: "no_model",
    status: "unanswered",
  });
  yield* awaited(opened.harness.close(context));
});

describe("generation recovery", () => {
  it("fails no_model when the pinned model is gone after reopen, in request and in poll", () =>
    Effect.runPromise(failsNoModel));
});

const runsPrintStyle = Effect.gen(function* () {
  const path = yield* sqlitePath();
  const setup = chatSetup();
  addSection(setup.registry, "preamble", () => "You are terse.", { tag: false });
  setup.faux.setResponses([fauxAssistantMessage("42")]);
  let opened = yield* open(path, setup);
  opened.harness.resume();
  const submission = yield* awaited(
    opened.root.submit({ content: "answer?", type: "input" }, context),
  );
  const settled = yield* awaited(submission.wait(context));
  if (settled.status !== "done" || settled.type !== "input")
    throw new Error(`Unexpected ${settled.status}`);
  const answer = yield* awaited(
    opened.root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context),
  );
  expect(textOf(answer?.model?.[0])).toBe("42");
  yield* awaited(opened.harness.close(context));

  opened = yield* open(path, setup);
  expect(
    yield* awaited(
      (yield* awaited(opened.harness.submission(submission.id, context)))!.status(context),
    ),
  ).toEqual(settled);
  expect(
    yield* awaited(opened.root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context)),
  ).toEqual(answer);
  yield* awaited(opened.harness.close(context));
});

describe("generation recovery", () => {
  it("runs a print-style turn and reads the durable answer after reopen", () =>
    Effect.runPromise(runsPrintStyle));
});

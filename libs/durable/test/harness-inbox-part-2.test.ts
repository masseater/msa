import { Type, fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { LiveDoc, defineTool } from "@msa/durable";
import { GenerationTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessInboxSupport from "./harness-inbox-support.ts";
import support from "./support.ts";

const { HOLD, answer, directories, gated, holdTool, queuedNote, status, toolRunning, transcript } =
  harnessInboxSupport;
const {
  addHooks,
  addTool,
  allEntries,
  awaited,
  chatSetup,
  context,
  deferred,
  openChat,
  removeDir,
  waitFor,
} = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const keepsOnYieldContinuation = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step, answer("second")]);
  let yields = 0;
  addHooks(setup.registry, GenerationTask, {
    onYield: () => (yields++ === 0 ? { continue: "more" } : undefined),
  });
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(first.reached);
  const write = yield* awaited(root.submit({ entry: queuedNote("w"), type: "write" }, context));
  first.release();
  yield* awaited(input.wait(context));
  const entries = yield* allEntries(root);
  expect(transcript(entries)).toEqual([
    "msa.user:a",
    "msa.assistant:first",
    "note:w",
    "msa.user:more",
    "msa.assistant:second",
  ]);
  expect(yield* awaited(status(input))).toMatchObject({
    answer: entries.at(-1)!.id,
    status: "done",
  });
  expect(yield* awaited(status(write))).toMatchObject({ status: "done" });
  yield* awaited(harness.close(context));
});

const dropsOnYieldContinuation = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step]);
  addHooks(setup.registry, GenerationTask, { onYield: () => ({ continue: "more" }) });
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(first.reached);
  yield* awaited(root.reset(undefined, context));
  first.release();
  yield* awaited(input.wait(context));
  yield* awaited(harness.waitForIdle(context));
  expect(yield* awaited(status(input))).toMatchObject({ status: "done" });
  expect(transcript(yield* allEntries(root))).toEqual([
    "msa.user:a",
    "msa.assistant:first",
    "msa.reset",
  ]);
  expect(setup.faux.state.callCount).toBe(1);
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("keeps an onYield continuation across a queued plain write, with the run's original input", () =>
    Effect.runPromise(keepsOnYieldContinuation));

  it("drops an onYield continuation for a queued reset", () =>
    Effect.runPromise(dropsOnYieldContinuation));
});

const addsEverySteer = Effect.gen(function* () {
  const setup = chatSetup();
  const gate = deferred();
  holdTool(setup, gate);
  setup.faux.setResponses([HOLD, answer("after tools"), answer("follow-up")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  setup.settings.steeringMode = "all";
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* toolRunning(harness, root);
  const s1 = yield* awaited(
    root.submit({ content: "s1", type: "input", whenBusy: "steer" }, context),
  );
  const f = yield* awaited(root.submit({ content: "f", type: "input" }, context));
  const s2 = yield* awaited(
    root.submit({ content: "s2", type: "input", whenBusy: "steer" }, context),
  );
  gate.resolve();
  yield* awaited(f.wait(context));
  const entries = yield* allEntries(root);
  expect(transcript(entries)).toEqual([
    "msa.user:a",
    "msa.assistant",
    "msa.tool-result",
    "msa.user:s1",
    "msa.user:s2",
    "msa.assistant:after tools",
    "msa.user:f",
    "msa.assistant:follow-up",
  ]);
  const answers = entries.filter((entry) => entry.kind === "msa.assistant");
  for (const submission of [input, s1, s2]) {
    expect(yield* awaited(status(submission))).toMatchObject({
      answer: answers[1]!.id,
      status: "done",
    });
  }
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("adds every steer to the run at the postTools boundary with steeringMode all", () =>
    Effect.runPromise(addsEverySteer));
});

const queuesIdleSteer = Effect.gen(function* () {
  const setup = chatSetup();
  const failing = gated(
    fauxAssistantMessage([], { errorMessage: "invalid request", stopReason: "error" }),
  );
  setup.faux.setResponses([failing.step, answer("both")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(failing.reached);
  const f = yield* awaited(root.submit({ content: "f", type: "input" }, context));
  failing.release();
  yield* awaited(input.wait(context));
  yield* awaited(harness.waitForIdle(context));
  const steer = yield* awaited(
    root.submit({ content: "s", type: "input", whenBusy: "steer" }, context),
  );
  const settled = yield* awaited(steer.wait(context));
  expect(yield* awaited(status(f))).toMatchObject({
    answer: settled.status === "done" && settled.answer,
    status: "done",
  });
  expect(transcript(yield* allEntries(root)).slice(-3)).toEqual([
    "msa.user:f",
    "msa.user:s",
    "msa.assistant:both",
  ]);
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("queues an idle steer behind waiting items and places it with the first follow-up in ID order", () =>
    Effect.runPromise(queuesIdleSteer));
});

const startsQueuedFollow = Effect.gen(function* () {
  const setup = chatSetup();
  const gate = deferred();
  holdTool(setup, gate, { control: { terminate: true }, output: [] });
  setup.faux.setResponses([HOLD, answer("follow-up")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* toolRunning(harness, root);
  const f = yield* awaited(root.submit({ content: "f", type: "input" }, context));
  gate.resolve();
  yield* awaited(f.wait(context));
  const calling = (yield* allEntries(root)).find((entry) => entry.kind === "msa.assistant")!;
  expect(yield* awaited(status(input))).toMatchObject({ answer: calling.id, status: "done" });
  expect(transcript(yield* allEntries(root))).toEqual([
    "msa.user:a",
    "msa.assistant",
    "msa.tool-result",
    "msa.user:f",
    "msa.assistant:follow-up",
  ]);
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("starts a queued follow-up after a terminating round", () =>
    Effect.runPromise(startsQueuedFollow));
});

const writesLastHandoffStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const firstGate = deferred();
  const secondGate = deferred();
  holdTool(setup, firstGate, { control: { handoff: "one" }, output: [] });
  addTool(
    setup.registry,
    defineTool({
      description: "Finishes first",
      execute: () =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(secondGate.promise);
            return { control: { handoff: "two" }, output: [] };
          }),
        ),
      name: "later",
      parameters: Type.Object({}),
    }),
  );
  const round = fauxAssistantMessage(
    [fauxToolCall("hold", {}, { id: "c1" }), fauxToolCall("later", {}, { id: "c2" })],
    { stopReason: "toolUse" },
  );
  setup.faux.setResponses([round, answer("follow-up")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* toolRunning(harness, root);
  const f = yield* awaited(root.submit({ content: "f", type: "input" }, context));
  secondGate.resolve();
  yield* waitFor(
    Effect.gen(function* () {
      return (
        (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))?.tools?.[1]?.status === "done"
      );
    }),
  );
  firstGate.resolve();
  yield* awaited(f.wait(context));
  return { harness, input, root };
});

const writesLastHandoff = Effect.gen(function* () {
  const { harness, root, input } = yield* writesLastHandoffStep1;
  expect(yield* awaited(status(input))).toMatchObject({ status: "done" });
  expect(transcript(yield* allEntries(root)).slice(-4)).toEqual([
    "msa.tool-result",
    "msa.reset:two",
    "msa.user:f",
    "msa.assistant:follow-up",
  ]);
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("writes the last handoff in call order and then runs queued follow-ups in the new context", () =>
    Effect.runPromise(writesLastHandoff));
});

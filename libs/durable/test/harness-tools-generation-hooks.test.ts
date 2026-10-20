import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import harnessToolsSupport from "./harness-tools-support.ts";
import support from "./support.ts";

const { fauxAssistantMessage, fauxText } = ai;

const { GenerationTask, ToolTask } = harnessModule;
const { LiveDoc } = durable;

const { DONE, calls, run, tool } = harnessToolsSupport;
const { addHooks, addTool, awaited, chatSetup, context, textOf } = support;

const replacesRequestMessages = Effect.gen(function* () {
  const setup = chatSetup();
  const requests: string[][] = [];
  const record: aiTypes.FauxResponseStep = (request) => {
    requests.push(
      request.messages.map((message) => `${message.role}:${textOf(message as never) ?? ""}`),
    );
    return fauxAssistantMessage([fauxText(`answer ${requests.length}`)]);
  };
  addHooks(setup.registry, GenerationTask, {
    beforeRequest: ({ messages }) => ({
      messages: [...messages, { content: "injected", role: "user", timestamp: 0 }],
    }),
  });
  const responses: string[] = [];
  addHooks(setup.registry, GenerationTask, {
    afterResponse: (message) => void responses.push(textOf(message) ?? ""),
  });
  let yields = 0;
  addHooks(setup.registry, GenerationTask, {
    onYield: () =>
      yields++ === 0 ? { continue: [{ text: "keep going", type: "text" }] } : undefined,
  });
  const { harness, entries, status } = yield* run(setup, [record, record]);
  expect(status).toBe("done");
  expect(requests[0]!.slice(-2)).toEqual(["user:go", "user:injected"]);
  expect(responses).toEqual(["answer 1", "answer 2"]);
  expect(entries.map((entry) => entry.kind)).toEqual([
    "msa.user",
    "msa.assistant",
    "msa.user",
    "msa.assistant",
  ]);
  expect(entries.some((entry) => textOf(entry.model?.[0]) === "injected")).toBe(false);
  yield* awaited(harness.close(context));
});

describe("generation hooks", () => {
  it("replaces request messages, observes responses, and continues on yield", () =>
    Effect.runPromise(replacesRequestMessages));
});

const keepsRunInput = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  let yields = 0;
  let harness!: durableTypes.Harness;
  let input: durableTypes.SubmissionId | undefined;
  let statusAtSecondRequest: string | undefined;
  addHooks(setup.registry, GenerationTask, {
    onYield: () => (yields++ === 0 ? { continue: "again" } : undefined),
  });
  const second: aiTypes.FauxResponseStep = () =>
    runPromise(
      Effect.gen(function* () {
        input = (yield* awaited(harness.snapshot(LiveDoc, 1 as never, context)))!.run!.inputs[0];
        statusAtSecondRequest = (yield* awaited(
          (yield* awaited(harness.submission(input!, context)))!.status(context),
        )).status;
        return fauxAssistantMessage([fauxText("second")]);
      }),
    );
  const result = yield* run(
    setup,
    [fauxAssistantMessage([fauxText("first")]), second],
    (opened) => {
      harness = opened;

      return Promise.resolve();
    },
  );
  expect(statusAtSecondRequest).toBe("placed");
  const answers = result.entries.filter((entry) => entry.kind === "msa.assistant");
  expect(
    yield* awaited((yield* awaited(harness.submission(input!, context)))!.status(context)),
  ).toMatchObject({
    answer: answers[1]!.id,
    status: "done",
  });
  yield* awaited(harness.close(context));
});

const observesResponsesArrive = Effect.gen(function* () {
  const setup = chatSetup({ deferred: { pendingFetches: 1, pollAfterMs: 1 } });
  const observed: string[] = [];
  addHooks(setup.registry, GenerationTask, {
    afterResponse: (message) =>
      void observed.push(`${message.stopReason}:${textOf(message) ?? ""}`),
  });
  setup.settings.stream = { deferred: true };
  const result = yield* run(setup, [fauxAssistantMessage([fauxText("late")])]);
  expect(result.status).toBe("done");
  expect(observed).toEqual(["stop:late"]);
  yield* awaited(result.harness.close(context));
});

describe("generation hooks", () => {
  it("keeps the run's input open across an onYield continuation and answers it with the final answer", () =>
    Effect.runPromise(keepsRunInput));

  it("observes responses that arrive by polling a deferred request", () =>
    Effect.runPromise(observesResponsesArrive));
});

const letsFirstOnYield = Effect.gen(function* () {
  const setup = chatSetup();
  const called: string[] = [];
  addHooks(setup.registry, GenerationTask, {
    afterResponse: () => {
      called.push("throwing observer");
      throw new Error("observer failed");
    },
  });
  addHooks(setup.registry, GenerationTask, {
    afterResponse: () => void called.push("next observer"),
  });
  let yields = 0;
  addHooks(setup.registry, GenerationTask, {
    onYield: () => (yields++ === 0 ? { continue: "first" } : undefined),
  });
  addHooks(setup.registry, GenerationTask, {
    onYield: () => {
      called.push("second onYield");
      return called.filter((name) => name === "second onYield").length === 1
        ? { continue: "second" }
        : undefined;
    },
  });
  const { harness, entries } = yield* run(setup, [
    fauxAssistantMessage([fauxText("a")]),
    fauxAssistantMessage([fauxText("b")]),
    fauxAssistantMessage([fauxText("c")]),
  ]);
  const users = entries
    .filter((entry) => entry.kind === "msa.user")
    .map((entry) => textOf(entry.model![0]));
  expect(users).toEqual(["go", "first", "second"]);
  expect(called.filter((name) => name === "second onYield")).toHaveLength(2);
  expect(called.filter((name) => name === "next observer")).toHaveLength(3);
  expect(setup.reports.map((error) => (error as Error).message)).toContain("observer failed");
  yield* awaited(harness.close(context));
});

describe("generation hooks", () => {
  it("lets the first onYield continuation win and reports throws without stopping later handlers", () =>
    Effect.runPromise(letsFirstOnYield));
});

const keepsDurableHook = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  let asked = 0;
  addTool(
    setup.registry,
    tool("echo", () => Promise.resolve({ output: [] })),
  );
  addHooks(setup.registry, ToolTask, {
    beforeTool: (_call, api) =>
      runPromise(
        Effect.gen(function* () {
          asked++;
          const decision = yield* awaited(api.memo("approval:decision", "approved", context));
          expect(yield* awaited(api.memo("approval:decision", "denied", context))).toBe(decision);
          return undefined;
        }),
      ),
  });
  const { harness } = yield* run(setup, [calls(["echo", {}, "c1"]), DONE]);
  expect(asked).toBe(1);
  yield* awaited(harness.close(context));
});

describe("generation hooks", () => {
  it("keeps durable hook decisions in task memos", () => Effect.runPromise(keepsDurableHook));
});

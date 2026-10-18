import { type FauxResponseStep, fauxAssistantMessage, fauxText } from "@msa/ai";
import { configure, defineTask, type Harness, LiveDoc, type SubmissionId } from "@msa/durable";
import { GenerationTask, ToolTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { chatSetup, openChat, textOf } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { addHooks, addTask, addTool } from "./harness-support.ts";
import { resultText, results, DONE, calls, run, tool } from "./harness-tools-support.ts";
import { context } from "./session-support.ts";

const replacesRequestMessages = Effect.gen(function* () {
  const setup = chatSetup();
  const requests: string[][] = [];
  const record: FauxResponseStep = (request) => {
    requests.push(
      request.messages.map((message) => `${message.role}:${textOf(message as never) ?? ""}`),
    );
    return fauxAssistantMessage([fauxText(`answer ${requests.length}`)]);
  };
  addHooks(setup.registry, GenerationTask, {
    beforeRequest: ({ messages }) => ({
      messages: [...messages, { role: "user", content: "injected", timestamp: 0 }],
    }),
  });
  const responses: string[] = [];
  addHooks(setup.registry, GenerationTask, {
    afterResponse: (message) => void responses.push(textOf(message) ?? ""),
  });
  let yields = 0;
  addHooks(setup.registry, GenerationTask, {
    onYield: () =>
      yields++ === 0 ? { continue: [{ type: "text", text: "keep going" }] } : undefined,
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
  let harness!: Harness;
  let input: SubmissionId | undefined;
  let statusAtSecondRequest: string | undefined;
  addHooks(setup.registry, GenerationTask, {
    onYield: () => (yields++ === 0 ? { continue: "again" } : undefined),
  });
  const second: FauxResponseStep = () =>
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
    status: "done",
    answer: answers[1]!.id,
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

function probingToolSetup() {
  const setup = chatSetup();
  const child = defineTask<{ n: number }, { phase: "run" }, number>({
    name: "test.child",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: (task, runtime, callContext) =>
        Effect.runPromise(
          Effect.asVoid(
            Effect.suspend(() =>
              awaited(
                runtime.commit(
                  () => ({
                    status: "terminal",
                    outcome: { status: "completed", result: task.input.n * 2 },
                  }),
                  callContext,
                ),
              ),
            ),
          ),
        ),
    },
    abort: () => Promise.resolve(),
  });
  addTask(setup.registry, child);
  const seen: unknown[] = [];
  const probe = tool("probe", (_args, api) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        seen.push(api.env?.cwd);
        seen.push((yield* awaited(api.agent(context))).tools.map((each) => each.name));
        seen.push(api.registry.extension("tool:probe") !== undefined);
        const entry = yield* awaited(
          api.commit(
            (tx) =>
              runPromise(
                Effect.gen(function* () {
                  yield* awaited(configure(tx, api.conversationId, { cwd: "/" }));
                  return yield* awaited(
                    tx.appendEntry(api.conversationId, {
                      kind: "test.note",
                      data: api.callId,
                    }),
                  );
                }),
              ),
            context,
          ),
        );
        seen.push(entry.byTaskId === api.taskId);
        seen.push(
          yield* awaited(api.memo("m", 1, context)),
          yield* awaited(api.memo("m", 2, context)),
        );
        const id = yield* awaited(
          api.createTask(child, { n: 21 }, { ownership: { kind: "conversation" } }, context),
        );
        const done = yield* awaited(api.waitForTask(id, context));
        seen.push(done.state.outcome);
        return { output: [] };
      }),
    ),
  );
  addTool(setup.registry, probe);
  return { setup, seen };
}

const buildsEnvironmentPer = Effect.gen(function* () {
  const { setup, seen } = probingToolSetup();
  setup.faux.setResponses([calls(["probe", {}, "c1"], ["probe", {}, "c2"]), DONE]);
  setup.settings.toolExecution = "sequential";
  const targets: unknown[] = [];
  const { harness, root } = yield* openChat(new MemoryStorage(), setup, {
    env: ({ conversationId, cwd }) => {
      targets.push([conversationId, cwd]);
      return new NodeExecutionEnv({ cwd: cwd ?? "/tmp" });
    },
  });
  yield* awaited(root.configure({ cwd: "/tmp" }, context));
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  const outcome = { status: "completed", result: 42 };
  const call = (cwd: string) => [cwd, ["probe"], true, true, 1, 1, outcome];
  expect(seen).toEqual([...call("/tmp"), ...call("/")]);
  expect(targets).toContainEqual([root.id, "/tmp"]);
  expect(targets).toContainEqual([root.id, "/"]);
  yield* awaited(harness.close(context));
});

const answersThrowingEnvironment = Effect.gen(function* () {
  const setup = chatSetup();
  addTool(
    setup.registry,
    tool("probe", () => Promise.resolve({ output: [{ type: "text", text: "ran" }] })),
  );
  const { harness, entries } = yield* run(setup, [calls(["probe", {}, "c1"]), DONE], undefined, {
    env: () => {
      throw new Error("no sandbox");
    },
  });
  const [result] = results(entries);
  expect(result).toMatchObject({ isError: true });
  expect(resultText(result!)).toBe("<harness>\n[error] no sandbox\n</harness>");
  expect(setup.reports.filter((error) => (error as Error).message === "no sandbox").length).toBe(2);
  yield* awaited(harness.close(context));
});

describe("tool execution api", () => {
  it("builds the environment per call from the conversation's cwd and runs commits, memos, and child tasks", () =>
    Effect.runPromise(buildsEnvironmentPer));

  it("answers a throwing environment with a tool_error result and reports it once while preparing", () =>
    Effect.runPromise(answersThrowingEnvironment));
});

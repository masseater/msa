import { type Message, type Models, type SystemMessage, fauxAssistantMessage } from "@msa/ai";
import { type Conversation, defineDoc } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { resolveSettings } from "../src/harness/agent.ts";
import harnessGenerationSupport from "./harness-generation-support.ts";
import support from "./support.ts";
import type supportTypes from "./support.types.ts";

const { heldStream, invalidFinalStream, live, livePublications, withStream } =
  harnessGenerationSupport;
const { addSection, allEntries, awaited, chatSetup, context, openChat, textOf, waitFor } = support;

const documentSectionsChat = Effect.fn("documentSectionsChat")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Agent = defineDoc<{ cwd: string; kind: string }>({
    fork: "current",
    history: "latest",
    initial: () => ({ cwd: "/", kind: "main" }),
    kind: "test.agent",
    scope: "conversation",
    version: 1,
  });
  const setup = chatSetup();
  addSection(setup.registry, "cwd", (input, ctx) =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(input.read.snapshot(Agent, input.conversationId, ctx)))?.cwd;
      }),
    ),
  );
  addSection(setup.registry, "agents", (input, ctx) =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(input.read.snapshot(Agent, input.conversationId, ctx)))?.kind ===
          "sub"
          ? undefined
          : "Read AGENTS.md";
      }),
    ),
  );
  setup.faux.setResponses([fauxAssistantMessage("a"), fauxAssistantMessage("b")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  return { Agent, harness, root };
});

describe("generation", () => {
  it("resolves settings over the built-in defaults", () => {
    expect(resolveSettings(undefined)).toEqual({
      compaction: {
        backgroundTokens: 32768,
        enabled: true,
        keepRecentTokens: 20000,
        reserveTokens: 16384,
      },
      contextRetentionMs: 600_000,
      documentRetentionMs: expect.any(Number),
      followUpMode: "one-at-a-time",
      progress: { outputIntervalMs: 100, partialIntervalMs: 100 },
      retry: { baseDelayMs: 2000, enabled: true, maxAgentDelayMs: 60000, maxRetries: 3 },
      steeringMode: "one-at-a-time",
      stream: {},
      toolExecution: "parallel",
    });
    expect(
      resolveSettings({ compaction: { backgroundTokens: 0 }, retry: { enabled: false } }),
    ).toMatchObject({
      compaction: { backgroundTokens: 0, enabled: true },
      retry: { baseDelayMs: 2000, enabled: false, maxRetries: 3 },
    });
    expect(resolveSettings({ progress: { outputIntervalMs: 500 } }).progress).toEqual({
      outputIntervalMs: 500,
      partialIntervalMs: 100,
    });
  });
});

const commitsPartialsNo = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const shortStream = (): ReturnType<Models["streamSimple"]> =>
    heldStream(
      { partial: fauxAssistantMessage("partial", { stopReason: "pending" }), type: "start" },
      fauxAssistantMessage("final"),
    );
  const publishedPartial = (settings: supportTypes.ChatSetup["settings"]): Promise<boolean> =>
    runPromise(
      Effect.gen(function* () {
        const base = chatSetup();
        const setup: supportTypes.ChatSetup = {
          ...base,
          models: withStream(base.models, shortStream),
          settings,
        };
        const { harness, root } = yield* openChat(new MemoryStorage(), setup);
        const values = livePublications(harness);
        harness.resume();
        const submission = yield* awaited(root.submit({ content: "hi", type: "input" }, context));
        expect(yield* awaited(submission.wait(context))).toMatchObject({ status: "done" });
        yield* awaited(harness.close(context));
        return values.some((value) => textOf(value.generation?.message as Message) === "partial");
      }),
    );
  expect(yield* awaited(publishedPartial({}))).toBe(true);
  expect(yield* awaited(publishedPartial({ progress: { partialIntervalMs: 5000 } }))).toBe(false);
});

describe("generation", () => {
  it("commits partials no more often than progress.partialIntervalMs", () =>
    Effect.runPromise(commitsPartialsNo));
});

const rendersSectionsReadStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { Agent, harness, root } = yield* documentSectionsChat();
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(Agent, root.id))).cwd = "/repo";
          }),
        ),
      context,
    ),
  );
  const sub = yield* awaited(
    harness.createConversation(
      {
        agent: { model: { modelId: "faux-1", provider: "faux" } },
        init: (tx, id) =>
          runPromise(
            Effect.gen(function* () {
              const agent = yield* awaited(tx.doc(Agent, id));
              agent.kind = "sub";
              agent.cwd = "/sub";
            }),
          ),
        ownership: { kind: "ownerless" },
      },
      context,
    ),
  );
  harness.resume();
  yield* awaited(
    (yield* awaited(root.submit({ content: "one", type: "input" }, context))).wait(context),
  );
  yield* awaited(
    (yield* awaited(sub.submit({ content: "two", type: "input" }, context))).wait(context),
  );
  return { harness, root, runPromise, sub };
});

const rendersSectionsRead = Effect.gen(function* () {
  const { runPromise, harness, root, sub } = yield* rendersSectionsReadStep1;
  const sections = (conversation: Conversation) =>
    runPromise(
      Effect.gen(function* () {
        return (yield* allEntries(conversation)).find((entry) => entry.kind === "msa.system")
          ?.model?.[0];
      }),
    );
  expect(yield* awaited(sections(root))).toMatchObject({
    sections: { agents: "<agents>\nRead AGENTS.md\n</agents>", cwd: "<cwd>\n/repo\n</cwd>" },
  });
  expect((yield* awaited(sections(sub))) as SystemMessage).toEqual({
    content: "",
    role: "system",
    sections: { cwd: "<cwd>\n/sub\n</cwd>" },
    timestamp: expect.any(Number),
  });
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("renders sections that read conversation documents through input.read", () =>
    Effect.runPromise(rendersSectionsRead));
});

const commitsNoPartial = Effect.gen(function* () {
  const base = chatSetup();
  const handle = {
    api: "faux",
    id: "handle-1",
    modelId: "faux-1",
    pollAfterMs: 60_000,
    provider: "faux",
  };
  const deferredStream = (): ReturnType<Models["streamSimple"]> =>
    heldStream(
      { partial: fauxAssistantMessage([], { stopReason: "pending" }), type: "start" },
      fauxAssistantMessage([], { deferred: handle, stopReason: "deferred" }),
    );
  const setup: supportTypes.ChatSetup = {
    ...base,
    models: withStream(base.models, deferredStream),
  };
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const values = livePublications(harness);
  const submission = yield* awaited(root.submit({ content: "hi", type: "input" }, context));
  yield* waitFor(
    Effect.gen(function* () {
      return (yield* awaited(live(harness, root)))?.generation?.deferred !== undefined;
    }),
  );
  expect(values.some((value) => value.generation?.message !== undefined)).toBe(false);
  yield* awaited(harness.abortTask((yield* awaited(live(harness, root)))!.run!.taskId, context));
  expect(yield* awaited(submission.wait(context))).toMatchObject({
    reason: "aborted",
    status: "unanswered",
  });
  expect((yield* allEntries(root)).map((entry) => entry.kind)).toEqual(["msa.user"]);
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("commits no partial for a response that turns deferred after an empty start event", () =>
    Effect.runPromise(commitsNoPartial));
});

const faultsRunTask = Effect.gen(function* () {
  const base = chatSetup();
  const setup: supportTypes.ChatSetup = {
    ...base,
    models: withStream(base.models, invalidFinalStream),
  };
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const values = livePublications(harness);
  harness.resume();
  const submission = yield* awaited(root.submit({ content: "hi", type: "input" }, context));
  expect(yield* awaited(submission.wait(context))).toMatchObject({
    detail: expect.stringContaining("non-JSON function"),
    reason: "faulted",
    status: "unanswered",
  });
  expect(values.some((value) => textOf(value.generation?.message as Message) === "partial")).toBe(
    true,
  );
  const entries = yield* allEntries(root);
  expect(entries.map((entry) => entry.kind)).toEqual(["msa.user", "msa.assistant"]);
  expect(entries[1]!.model![0]).toMatchObject({ role: "assistant", stopReason: "aborted" });
  expect(textOf(entries[1]!.model![0])).toBe("partial");
  expect(yield* awaited(live(harness, root))).toEqual({});
  const tasks = yield* awaited(
    harness.commit((tx) => tx.scanTasks({ conversationId: root.id }, 10), context),
  );
  expect(tasks.items[0]!.state).toMatchObject({
    outcome: { status: "faulted" },
    status: "terminal",
  });
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("faults a run task, settling its inputs and converting the committed partial", () =>
    Effect.runPromise(faultsRunTask));
});

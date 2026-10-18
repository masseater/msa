import { fauxAssistantMessage, type Message, type Models, type SystemMessage } from "@msa/ai";
import { type Conversation, defineDoc, LiveDoc, UserEntry } from "@msa/durable";
import { GenerationTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { resolveSettings } from "../src/harness/agent.ts";
import type { SessionImpl } from "../src/session/session.ts";
import {
  allEntries,
  type ChatSetup,
  chatSetup,
  openChat,
  textOf,
  waitFor,
} from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import {
  heldStream,
  invalidFinalStream,
  livePublications,
  live,
  withStream,
} from "./harness-generation-support.ts";
import { addSection } from "./harness-support.ts";
import { context } from "./session-support.ts";

const documentSectionsChat = Effect.fn("documentSectionsChat")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Agent = defineDoc<{ cwd: string; kind: string }>({
    kind: "test.agent",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ cwd: "/", kind: "main" }),
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
      stream: {},
      retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000, maxAgentDelayMs: 60000 },
      compaction: {
        enabled: true,
        reserveTokens: 16384,
        keepRecentTokens: 20000,
        backgroundTokens: 32768,
      },
      progress: { partialIntervalMs: 100, outputIntervalMs: 100 },
      toolExecution: "parallel",
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      contextRetentionMs: 600_000,
      documentRetentionMs: expect.any(Number),
    });
    expect(
      resolveSettings({ retry: { enabled: false }, compaction: { backgroundTokens: 0 } }),
    ).toMatchObject({
      retry: { enabled: false, maxRetries: 3, baseDelayMs: 2000 },
      compaction: { enabled: true, backgroundTokens: 0 },
    });
    expect(resolveSettings({ progress: { outputIntervalMs: 500 } }).progress).toEqual({
      partialIntervalMs: 100,
      outputIntervalMs: 500,
    });
  });
});

const commitsPartialsNo = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const shortStream = (): ReturnType<Models["streamSimple"]> =>
    heldStream(
      { type: "start", partial: fauxAssistantMessage("partial", { stopReason: "pending" }) },
      fauxAssistantMessage("final"),
    );
  const publishedPartial = (settings: ChatSetup["settings"]): Promise<boolean> =>
    runPromise(
      Effect.gen(function* () {
        const base = chatSetup();
        const setup: ChatSetup = {
          ...base,
          settings,
          models: withStream(base.models, shortStream),
        };
        const { harness, root } = yield* openChat(new MemoryStorage(), setup);
        const values = livePublications(harness);
        harness.resume();
        const submission = yield* awaited(root.submit({ type: "input", content: "hi" }, context));
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

const rendersSectionsRead = Effect.gen(function* () {
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
        ownership: { kind: "ownerless" },
        agent: { model: { provider: "faux", modelId: "faux-1" } },
        init: (tx, id) =>
          runPromise(
            Effect.gen(function* () {
              const agent = yield* awaited(tx.doc(Agent, id));
              agent.kind = "sub";
              agent.cwd = "/sub";
            }),
          ),
      },
      context,
    ),
  );
  harness.resume();
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "one" }, context))).wait(context),
  );
  yield* awaited(
    (yield* awaited(sub.submit({ type: "input", content: "two" }, context))).wait(context),
  );
  const sections = (conversation: Conversation) =>
    runPromise(
      Effect.gen(function* () {
        return (yield* allEntries(conversation)).find((entry) => entry.kind === "msa.system")
          ?.model?.[0];
      }),
    );
  expect(yield* awaited(sections(root))).toMatchObject({
    sections: { cwd: "<cwd>\n/repo\n</cwd>", agents: "<agents>\nRead AGENTS.md\n</agents>" },
  });
  expect((yield* awaited(sections(sub))) as SystemMessage).toEqual({
    role: "system",
    content: "",
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
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const base = chatSetup();
  const handle = {
    provider: "faux",
    modelId: "faux-1",
    api: "faux",
    id: "handle-1",
    pollAfterMs: 60_000,
  };
  const deferredStream = (): ReturnType<Models["streamSimple"]> =>
    heldStream(
      { type: "start", partial: fauxAssistantMessage([], { stopReason: "pending" }) },
      fauxAssistantMessage([], { stopReason: "deferred", deferred: handle }),
    );
  const setup: ChatSetup = { ...base, models: withStream(base.models, deferredStream) };
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const values = livePublications(harness);
  const submission = yield* awaited(root.submit({ type: "input", content: "hi" }, context));
  yield* waitFor(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(live(harness, root)))?.generation?.deferred !== undefined;
      }),
    ),
  );
  expect(values.some((value) => value.generation?.message !== undefined)).toBe(false);
  yield* awaited(harness.abortTask((yield* awaited(live(harness, root)))!.run!.taskId, context));
  expect(yield* awaited(submission.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "aborted",
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
  const setup: ChatSetup = { ...base, models: withStream(base.models, invalidFinalStream) };
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const values = livePublications(harness);
  harness.resume();
  const submission = yield* awaited(root.submit({ type: "input", content: "hi" }, context));
  expect(yield* awaited(submission.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "faulted",
    detail: expect.stringContaining("non-JSON function"),
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
    status: "terminal",
    outcome: { status: "faulted" },
  });
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("faults a run task, settling its inputs and converting the committed partial", () =>
    Effect.runPromise(faultsRunTask));
});

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

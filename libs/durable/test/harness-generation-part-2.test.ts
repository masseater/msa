import { fauxAssistantMessage, type Message, type Models, type SystemMessage } from "@msa/ai";
import {
  type Conversation,
  defineDoc,
  GenerationTask,
  LiveDoc,
  MemoryStorage,
  UserEntry,
} from "@msa/durable";
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
import { livePublications, live, withStream } from "./harness-generation-support.ts";
import { addSection } from "./harness-support.ts";
import { context } from "./session-support.ts";

// A stream that commits one partial and then ends with a final message that is not strict JSON, so the classification
// commit throws and the scheduler faults the task.
function invalidFinalStream(): ReturnType<Models["streamSimple"]> {
  const events = async function* () {
    yield { type: "start", partial: fauxAssistantMessage("partial", { stopReason: "pending" }) };
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
  };
  const final = { ...fauxAssistantMessage("final"), invalid: () => {} };
  return {
    [Symbol.asyncIterator]: events,
    result: () => Promise.resolve(final),
  } as unknown as ReturnType<Models["streamSimple"]>;
}

async function documentSectionsChat() {
  const Agent = defineDoc<{ cwd: string; kind: string }>({
    kind: "test.agent",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ cwd: "/", kind: "main" }),
  });
  const setup = chatSetup();
  addSection(
    setup.registry,
    "cwd",
    async (input, ctx) => (await input.read.snapshot(Agent, input.conversationId, ctx))?.cwd,
  );
  addSection(setup.registry, "agents", async (input, ctx) =>
    (await input.read.snapshot(Agent, input.conversationId, ctx))?.kind === "sub"
      ? undefined
      : "Read AGENTS.md",
  );
  setup.faux.setResponses([fauxAssistantMessage("a"), fauxAssistantMessage("b")]);
  const { harness, root } = await openChat(new MemoryStorage(), setup);
  return { Agent, harness, root };
}

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

describe("generation", () => {
  it("commits partials no more often than progress.partialIntervalMs", async () => {
    const shortStream = (): ReturnType<Models["streamSimple"]> => {
      const events = async function* () {
        yield {
          type: "start",
          partial: fauxAssistantMessage("partial", { stopReason: "pending" }),
        };
        // Longer than the default 100 ms, shorter than the configured interval.
        await new Promise((resolve) => {
          setTimeout(resolve, 300);
        });
      };
      const final = fauxAssistantMessage("final");
      return {
        [Symbol.asyncIterator]: events,
        result: () => Promise.resolve(final),
      } as unknown as ReturnType<Models["streamSimple"]>;
    };
    const publishedPartial = async (settings: ChatSetup["settings"]): Promise<boolean> => {
      const base = chatSetup();
      const setup: ChatSetup = { ...base, settings, models: withStream(base.models, shortStream) };
      const { harness, root } = await openChat(new MemoryStorage(), setup);
      const values = livePublications(harness);
      harness.resume();
      const submission = await root.submit({ type: "input", content: "hi" }, context);
      expect(await submission.wait(context)).toMatchObject({ status: "done" });
      await harness.close(context);
      return values.some((value) => textOf(value.generation?.message as Message) === "partial");
    };
    expect(await publishedPartial({})).toBe(true);
    expect(await publishedPartial({ progress: { partialIntervalMs: 5000 } })).toBe(false);
  });
});

describe("generation", () => {
  it("renders sections that read conversation documents through input.read", async () => {
    const { Agent, harness, root } = await documentSectionsChat();
    await root.commit(async (tx) => {
      (await tx.doc(Agent, root.id)).cwd = "/repo";
    }, context);
    const sub = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: { provider: "faux", modelId: "faux-1" } },
        init: async (tx, id) => {
          const agent = await tx.doc(Agent, id);
          agent.kind = "sub";
          agent.cwd = "/sub";
        },
      },
      context,
    );
    harness.resume();
    await (await root.submit({ type: "input", content: "one" }, context)).wait(context);
    await (await sub.submit({ type: "input", content: "two" }, context)).wait(context);
    const sections = async (conversation: Conversation) =>
      (await allEntries(conversation)).find((entry) => entry.kind === "msa.system")?.model?.[0];
    expect(await sections(root)).toMatchObject({
      sections: { cwd: "<cwd>\n/repo\n</cwd>", agents: "<agents>\nRead AGENTS.md\n</agents>" },
    });
    expect((await sections(sub)) as SystemMessage).toEqual({
      role: "system",
      content: "",
      sections: { cwd: "<cwd>\n/sub\n</cwd>" },
      timestamp: expect.any(Number),
    });
    await harness.close(context);
  });
});

describe("generation", () => {
  it("commits no partial for a response that turns deferred after an empty start event", async () => {
    const base = chatSetup();
    const handle = {
      provider: "faux",
      modelId: "faux-1",
      api: "faux",
      id: "handle-1",
      pollAfterMs: 60_000,
    };
    const deferredStream = (): ReturnType<Models["streamSimple"]> => {
      const events = async function* () {
        yield { type: "start", partial: fauxAssistantMessage([], { stopReason: "pending" }) };
        // Longer than the partial throttle: an empty partial would be committed here.
        await new Promise((resolve) => {
          setTimeout(resolve, 300);
        });
      };
      const final = fauxAssistantMessage([], { stopReason: "deferred", deferred: handle });
      return {
        [Symbol.asyncIterator]: events,
        result: () => Promise.resolve(final),
      } as unknown as ReturnType<Models["streamSimple"]>;
    };
    const setup: ChatSetup = { ...base, models: withStream(base.models, deferredStream) };
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const values = livePublications(harness);
    const submission = await root.submit({ type: "input", content: "hi" }, context);
    await waitFor(async () => (await live(harness, root))?.generation?.deferred !== undefined);
    expect(values.some((value) => value.generation?.message !== undefined)).toBe(false);
    await harness.abortTask((await live(harness, root))!.run!.taskId, context);
    expect(await submission.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "aborted",
    });
    expect((await allEntries(root)).map((entry) => entry.kind)).toEqual(["msa.user"]);
    await harness.close(context);
  });
});

describe("generation", () => {
  it("faults a run task, settling its inputs and converting the committed partial", async () => {
    const base = chatSetup();
    const setup: ChatSetup = { ...base, models: withStream(base.models, invalidFinalStream) };
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const values = livePublications(harness);
    harness.resume();
    const submission = await root.submit({ type: "input", content: "hi" }, context);
    expect(await submission.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "faulted",
      detail: expect.stringContaining("non-JSON function"),
    });
    expect(values.some((value) => textOf(value.generation?.message as Message) === "partial")).toBe(
      true,
    );
    const entries = await allEntries(root);
    expect(entries.map((entry) => entry.kind)).toEqual(["msa.user", "msa.assistant"]);
    expect(entries[1]!.model![0]).toMatchObject({ role: "assistant", stopReason: "aborted" });
    expect(textOf(entries[1]!.model![0])).toBe("partial");
    expect(await live(harness, root)).toEqual({});
    const tasks = await harness.commit(
      (tx) => tx.scanTasks({ conversationId: root.id }, 10),
      context,
    );
    expect(tasks.items[0]!.state).toMatchObject({
      status: "terminal",
      outcome: { status: "faulted" },
    });
    await harness.close(context);
  });
});

describe("generation", () => {
  it("orphans a blocked run task with full run cleanup", async () => {
    const setup = chatSetup();
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    // A run whose task was stored by a newer generation definition this process cannot run.
    const { taskId, submissionId } = await (harness as unknown as SessionImpl).commitWith(
      async (tx) => {
        const entry = await tx.appendEntry(UserEntry, root.id, {
          model: [{ role: "user", content: "hi", timestamp: 1 }],
        });
        const submission = await tx.createSubmission({
          conversationId: root.id,
          type: "input",
          status: "placed",
          entry: entry.id,
        });
        const taskId = await tx.createTask(
          { definition: { ...GenerationTask.definition, version: 2 } },
          {},
          { ownership: { kind: "conversation" }, conversationId: root.id },
        );
        (await tx.doc(LiveDoc, root.id)).run = { taskId, inputs: [submission.id] };
        return { taskId, submissionId: submission.id };
      },
      context,
    );
    harness.resume();
    await expect(
      root.submit({ type: "input", content: "busy", whenBusy: "reject" }, context),
    ).rejects.toThrow("is busy");
    expect(await harness.abortTask(taskId, context)).toBe("marked");
    expect((await harness.waitForTask(taskId, context)).state.outcome).toEqual({
      status: "orphaned",
      reason: "task_too_old",
    });
    expect(await (await harness.submission(submissionId, context))!.status(context)).toMatchObject({
      status: "unanswered",
      reason: "task_too_old",
    });
    expect(await live(harness, root)).toEqual({});
    await harness.close(context);
  });
});

import {
  type AssistantMessage,
  fauxAssistantMessage,
  type Message,
  type SimpleStreamOptions,
} from "@msa/ai";
import {
  AssistantEntry,
  Harness,
  type HarnessSettings,
  MemoryStorage,
  ProviderDoc,
} from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import {
  allEntries,
  type ChatSetup,
  chatSetup,
  openChat,
  textOf,
  waitFor,
} from "./chat-support.ts";
import { livePublications, ERROR_503, runTask, live } from "./harness-generation-support.ts";
import { context } from "./session-support.ts";

describe("generation", () => {
  it("polls a deferred response until it is ready", async () => {
    const setup = chatSetup({ deferred: { pendingFetches: 1, pollAfterMs: 1 } });
    setup.faux.setResponses([fauxAssistantMessage("deferred answer")]);
    setup.settings.stream = { deferred: true };
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const values = livePublications(harness);
    harness.resume();
    const settled = await (
      await root.submit({ type: "input", content: "hi" }, context)
    ).wait(context);
    if (settled.status !== "done" || settled.type !== "input")
      throw new Error(`Unexpected ${settled.status}`);
    expect(setup.faux.state.deferredFetchCount).toBe(2);
    const pollTimes = values.flatMap((value) =>
      value.generation?.deferred === undefined ? [] : [value.generation.deferred.pollAt],
    );
    expect(pollTimes.length).toBe(2);
    expect(pollTimes[1]!).toBeGreaterThan(pollTimes[0]!);
    const answer = await root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context);
    expect(textOf(answer?.model?.[0])).toBe("deferred answer");
    await harness.close(context);
  });
});

describe("generation", () => {
  it("converts the committed partial when aborted during streaming", async () => {
    const setup = chatSetup({ tokensPerSecond: 20, tokenSize: { min: 1, max: 1 } });
    setup.faux.setResponses([fauxAssistantMessage("x".repeat(400))]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    harness.resume();
    const submission = await root.submit({ type: "input", content: "hi" }, context);
    const taskId = await runTask(harness, root);
    await waitFor(
      async () => textOf((await live(harness, root))?.generation?.message as Message) !== undefined,
    );
    const partial = (await live(harness, root))!.generation!.message!;
    expect(await harness.abortTask(taskId, context)).toBe("marked");
    expect(await submission.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "aborted",
    });
    const entries = await allEntries(root);
    expect(entries.map((entry) => entry.kind)).toEqual(["msa.user", "msa.assistant"]);
    const converted = entries[1]!.model![0] as AssistantMessage;
    expect(converted.stopReason).toBe("aborted");
    expect(textOf(converted)!.startsWith(textOf(partial as Message)!)).toBe(true);
    expect(await live(harness, root)).toEqual({});
    expect((await harness.waitForTask(taskId, context)).state.outcome).toEqual({
      status: "aborted",
    });
    await harness.close(context);
  });

  it("cancels a deferred response when aborted during polling", async () => {
    const setup = chatSetup({ deferred: { pendingFetches: 100, pollAfterMs: 60_000 } });
    setup.faux.setResponses([fauxAssistantMessage("never")]);
    setup.settings.stream = { deferred: true };
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    harness.resume();
    const submission = await root.submit({ type: "input", content: "hi" }, context);
    const taskId = await runTask(harness, root);
    await waitFor(async () => (await live(harness, root))?.generation?.deferred !== undefined);
    await harness.abortTask(taskId, context);
    expect(await submission.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "aborted",
    });
    expect(setup.faux.state.cancelledDeferred).toHaveLength(1);
    expect(await live(harness, root)).toEqual({});
    await harness.close(context);
  });
});

describe("generation", () => {
  it("reports a failed deferred cancellation and still ends the run aborted", async () => {
    const base = chatSetup({ deferred: { pendingFetches: 100, pollAfterMs: 60_000 } });
    base.faux.setResponses([fauxAssistantMessage("never")]);
    const models = new Proxy(base.models, {
      get(target, property) {
        if (property === "cancelDeferred")
          return () => Promise.resolve(Promise.reject(new Error("cancel failed")));
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const setup: ChatSetup = { ...base, models };
    setup.settings.stream = { deferred: true };
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    harness.resume();
    const submission = await root.submit({ type: "input", content: "hi" }, context);
    const taskId = await runTask(harness, root);
    await waitFor(async () => (await live(harness, root))?.generation?.deferred !== undefined);
    await harness.abortTask(taskId, context);
    expect(await submission.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "aborted",
    });
    expect(setup.reports).toContainEqual(new Error("cancel failed"));
    expect(await live(harness, root)).toEqual({});
    await harness.close(context);
  });
});

describe("generation", () => {
  it("forwards stream options and the thinking level", async () => {
    const setup = chatSetup();
    const seen: (SimpleStreamOptions | undefined)[] = [];
    setup.faux.setResponses([
      (_context, options) => {
        seen.push(options);
        return fauxAssistantMessage("a");
      },
      (_context, options) => {
        seen.push(options);
        return fauxAssistantMessage("b");
      },
    ]);
    setup.settings.stream = { timeoutMs: 1234, headers: { "x-test": "1" } };
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    await root.configure({ thinkingLevel: "high" }, context);
    harness.resume();
    await (await root.submit({ type: "input", content: "one" }, context)).wait(context);
    // Both are read at the next preparation: the thinking level from msa.agent, the stream options live from settings.
    await root.configure({ thinkingLevel: null }, context);
    setup.settings.stream = { timeoutMs: 99 };
    await (await root.submit({ type: "input", content: "two" }, context)).wait(context);
    const sessionId = (await harness.snapshot(ProviderDoc, root.id, context))!.sessionId;
    expect(seen[0]).toMatchObject({
      timeoutMs: 1234,
      headers: { "x-test": "1" },
      reasoning: "high",
      sessionId,
    });
    expect(seen[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(seen[1]!.reasoning).toBeUndefined();
    expect(seen[1]).toMatchObject({ timeoutMs: 99, sessionId });
    expect(seen[1]!.headers).toBeUndefined();
    await harness.close(context);
  });
});

describe("generation", () => {
  // Regression coverage for #10424.
  it("keeps provider session IDs request-local across concurrent conversations", async () => {
    const setup = chatSetup();
    const seen = new Map<string, string[]>();
    const capture = (request: { messages: readonly Message[] }, options?: SimpleStreamOptions) => {
      const message = request.messages.findLast((candidate) => candidate.role === "user");
      const content = message?.role === "user" ? message.content : undefined;
      const text = typeof content === "string" ? content : "";
      const values = seen.get(text) ?? [];
      values.push(options?.sessionId ?? "");
      seen.set(text, values);
      return fauxAssistantMessage(`answer:${text}`);
    };
    setup.faux.setResponses([capture, capture, capture, capture]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const child = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: { provider: "faux", modelId: "faux-1" } },
      },
      context,
    );
    harness.resume();
    await Promise.all(
      [root, child].map(async (conversation, index) => {
        await (
          await conversation.submit({ type: "input", content: `first-${index}` }, context)
        ).wait(context);
      }),
    );
    await Promise.all(
      [root, child].map(async (conversation, index) => {
        await (
          await conversation.submit({ type: "input", content: `second-${index}` }, context)
        ).wait(context);
      }),
    );
    const rootId = (await harness.snapshot(ProviderDoc, root.id, context))!.sessionId;
    const childId = (await harness.snapshot(ProviderDoc, child.id, context))!.sessionId;
    expect(rootId).not.toBe(childId);
    expect(seen.get("first-0")).toEqual([rootId]);
    expect(seen.get("second-0")).toEqual([rootId]);
    expect(seen.get("first-1")).toEqual([childId]);
    expect(seen.get("second-1")).toEqual([childId]);
    await harness.close(context);
  });
});

describe("generation", () => {
  // Regression coverage for #10424.
  it("creates and persists provider state before a legacy conversation's request", async () => {
    const setup = chatSetup();
    let sent: string | undefined;
    setup.faux.setResponses([
      (_request, options) => {
        sent = options?.sessionId;
        return fauxAssistantMessage("ok");
      },
    ]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    await root.commit((tx) => tx.retireDoc(ProviderDoc, root.id), context);
    expect(await harness.snapshot(ProviderDoc, root.id, context)).toBeUndefined();
    harness.resume();
    await (await root.submit({ type: "input", content: "legacy" }, context)).wait(context);
    const stored = await harness.snapshot(ProviderDoc, root.id, context);
    expect(stored?.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(sent).toBe(stored?.sessionId);
    await harness.close(context);
  });
});

describe("generation", () => {
  it("reads settings through getters at every decision", async () => {
    const setup = chatSetup();
    let timeoutMs = 111;
    const seen: (number | undefined)[] = [];
    setup.faux.setResponses([
      (_context, options) => {
        seen.push(options?.timeoutMs);
        // The user changes the setting while the first attempt runs.
        timeoutMs = 222;
        return ERROR_503;
      },
      (_context, options) => {
        seen.push(options?.timeoutMs);
        return fauxAssistantMessage("ok");
      },
    ]);
    const settings: HarnessSettings = {
      get stream() {
        return { timeoutMs };
      },
      retry: { baseDelayMs: 1 },
    };
    const harness = await Harness.open(
      new MemoryStorage(),
      { models: setup.models, registry: setup.registry, settings },
      context,
    );
    const root = await harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    });
    harness.resume();
    expect(
      (await (await root.submit({ type: "input", content: "hi" }, context)).wait(context)).status,
    ).toBe("done");
    // The retry prepares again, so it resolves the settings again and sends the new timeout.
    expect(seen).toEqual([111, 222]);
    await harness.close(context);
  });
});

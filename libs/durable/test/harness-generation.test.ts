import { type AssistantMessage, fauxAssistantMessage } from "@msa/ai";
import { AssistantEntry, defineExtension, wrapSection } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, openChat, textOf, unanswered } from "./chat-support.ts";
import { livePublications, ERROR_503, runTask, live } from "./harness-generation-support.ts";
import { addSection } from "./harness-support.ts";
import { ControlledStorage, context } from "./session-support.ts";

describe("generation", () => {
  it("answers an input and settles its submission", async () => {
    const setup = chatSetup();
    addSection(setup.registry, "preamble", () => "You are helpful.", { tag: false });
    setup.faux.setResponses([fauxAssistantMessage("Hello there")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    harness.resume();
    const submission = await root.submit({ type: "input", content: "hi" }, context);
    const settled = await submission.wait(context);
    if (settled.status !== "done" || settled.type !== "input")
      throw new Error(`Unexpected ${settled.status}`);

    const answer = await root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context);
    expect(textOf(answer?.model?.[0])).toBe("Hello there");
    const entries = await allEntries(root);
    expect(entries.map((entry) => entry.kind)).toEqual(["msa.user", "msa.system", "msa.assistant"]);
    expect(entries[0]!.id).toBe(settled.entry);
    expect(entries[1]!.model).toEqual([
      {
        role: "system",
        content: "",
        sections: { preamble: "You are helpful." },
        timestamp: expect.any(Number),
      },
    ]);
    expect(await live(harness, root)).toEqual({});
    const task = (
      await harness.commit((tx) => tx.scanTasks({ conversationId: root.id }, 10), context)
    ).items[0];
    expect(task?.kind).toBe("msa.generation");
    // Entries written by the generation are attributed to it; the admitted user entry is not task work.
    expect(entries.map((entry) => entry.byTaskId)).toEqual([undefined, task!.id, task!.id]);
    expect(task?.state).toEqual({
      status: "terminal",
      outcome: { status: "completed", result: { entryId: settled.answer } },
    });
    await harness.close(context);
  });
});

describe("generation", () => {
  it("stores partials as deltas and a complete base once nothing is in flight", async () => {
    const setup = chatSetup({ tokensPerSecond: 200, tokenSize: { min: 1, max: 1 } });
    setup.faux.setResponses([fauxAssistantMessage("w".repeat(200))]);
    const storage = new ControlledStorage();
    const { harness, root } = await openChat(storage, setup);
    const record = await storage.findDocument(
      { kind: "msa.live", scope: { kind: "conversation", conversationId: root.id } },
      "current",
      context,
    );
    harness.resume();
    await (await root.submit({ type: "input", content: "hi" }, context)).wait(context);
    const contents = storage.commits.flatMap((writes) =>
      writes.flatMap((write) =>
        write.type === "document.change" && write.id === record!.id ? [write.content.kind] : [],
      ),
    );
    // Streaming writes deltas; the commit that settles the answer clears generation and writes a base.
    expect(contents).toContain("delta");
    expect(contents.at(-1)).toBe("base");
    await harness.close(context);
  });

  it("still ends a run whose input something else already settled", async () => {
    const setup = chatSetup();
    const busy = unanswered();
    setup.faux.setResponses([busy.step]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const submission = await root.submit({ type: "input", content: "hi" }, context);
    await busy.reached;
    await root.commit(
      (tx) => tx.settleSubmission(submission.id, { status: "unanswered", reason: "withdrawn" }),
      context,
    );
    const taskId = await runTask(harness, root);
    await harness.abortTask(taskId, context);
    expect((await harness.waitForTask(taskId, context)).state.outcome).toEqual({
      status: "aborted",
    });
    // The earlier settlement stays; the run's own settlement leaves it unchanged.
    expect(await submission.status(context)).toMatchObject({
      status: "unanswered",
      reason: "withdrawn",
    });
    expect(await live(harness, root)).toEqual({});
    await harness.close(context);
  });
});

describe("generation", () => {
  it("fails with no_model when no model is configured or the model is unknown", async () => {
    const setup = chatSetup();
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const plain = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
    harness.resume();
    const unset = await (
      await plain.submit({ type: "input", content: "hi" }, context)
    ).wait(context);
    expect(unset).toMatchObject({ status: "unanswered", reason: "no_model" });

    await root.configure({ model: { provider: "faux", modelId: "missing" } }, context);
    const unknown = await (
      await root.submit({ type: "input", content: "hi" }, context)
    ).wait(context);
    expect(unknown).toMatchObject({
      status: "unanswered",
      reason: "no_model",
      entry: expect.any(Number),
    });
    expect((await allEntries(root)).map((entry) => entry.kind)).toEqual(["msa.user"]);
    const tasks = await harness.commit(
      (tx) => tx.scanTasks({ conversationId: root.id }, 10),
      context,
    );
    expect(tasks.items[0]!.state).toEqual({
      status: "terminal",
      outcome: {
        status: "failed",
        error: { message: "Model faux/missing is not available", detail: { reason: "no_model" } },
      },
    });
    expect(await live(harness, root)).toEqual({});
    expect(await live(harness, plain)).toEqual({});
    await harness.close(context);
  });
});

describe("generation", () => {
  it("retries a retryable error after a durable backoff and then answers", async () => {
    const setup = chatSetup();
    addSection(setup.registry, "preamble", () => "p", { tag: false });
    setup.faux.setResponses([ERROR_503, fauxAssistantMessage("recovered")]);
    setup.settings.retry = { enabled: true, maxRetries: 3, baseDelayMs: 1 };
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const values = livePublications(harness);
    harness.resume();
    const settled = await (
      await root.submit({ type: "input", content: "hi" }, context)
    ).wait(context);
    expect(settled.status).toBe("done");
    const entries = await allEntries(root);
    expect(entries.map((entry) => entry.kind)).toEqual([
      "msa.user",
      "msa.system",
      "msa.assistant",
      "msa.assistant",
    ]);
    expect((entries[2]!.model![0] as AssistantMessage).stopReason).toBe("error");
    expect(
      values.some((value) => value.generation?.retry?.error === "503 Service Unavailable"),
    ).toBe(true);
    expect(values.some((value) => value.generation?.attempt === 2)).toBe(true);
    expect(await live(harness, root)).toEqual({});
    await harness.close(context);
  });
});

describe("generation", () => {
  it("fails with model_error once retries are exhausted", async () => {
    const setup = chatSetup();
    setup.faux.setResponses([ERROR_503, ERROR_503, fauxAssistantMessage("never")]);
    setup.settings.retry = { enabled: true, maxRetries: 1, baseDelayMs: 1 };
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    harness.resume();
    const settled = await (
      await root.submit({ type: "input", content: "hi" }, context)
    ).wait(context);
    expect(settled).toMatchObject({
      status: "unanswered",
      reason: "model_error",
      detail: "503 Service Unavailable",
    });
    expect((await allEntries(root)).map((entry) => entry.kind)).toEqual([
      "msa.user",
      "msa.assistant",
      "msa.assistant",
    ]);
    expect(setup.faux.getPendingResponseCount()).toBe(1);
    await harness.close(context);
  });

  it("fails a retryable error without retrying when the retry policy is disabled", async () => {
    const setup = chatSetup();
    setup.faux.setResponses([ERROR_503, fauxAssistantMessage("never")]);
    setup.settings.retry = { enabled: false };
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    harness.resume();
    const settled = await (
      await root.submit({ type: "input", content: "hi" }, context)
    ).wait(context);
    expect(settled).toMatchObject({ status: "unanswered", reason: "model_error" });
    expect(setup.faux.state.callCount).toBe(1);
    await harness.close(context);
  });
});

describe("generation", () => {
  it("reports section wrapper failures while preparing", async () => {
    const setup = chatSetup();
    addSection(setup.registry, "cwd", () => "/repo");
    setup.registry.install(
      defineExtension({
        name: "broken",
        wraps: [
          wrapSection("cwd", () => {
            throw new Error("wrapper failed");
          }),
        ],
      }),
    );
    setup.faux.setResponses([fauxAssistantMessage("ok")]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    harness.resume();
    expect(
      (await (await root.submit({ type: "input", content: "hi" }, context)).wait(context)).status,
    ).toBe("done");
    expect(setup.reports).toContainEqual(new Error("wrapper failed"));
    // The failed section is absent, so nothing was rendered.
    expect((await allEntries(root)).map((entry) => entry.kind)).toEqual([
      "msa.user",
      "msa.assistant",
    ]);
    await harness.close(context);
  });
});

describe("generation", () => {
  it("fails a non-retryable error without retrying", async () => {
    const setup = chatSetup();
    setup.faux.setResponses([
      fauxAssistantMessage([], { stopReason: "error", errorMessage: "Invalid request" }),
      fauxAssistantMessage("never"),
    ]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    harness.resume();
    const settled = await (
      await root.submit({ type: "input", content: "hi" }, context)
    ).wait(context);
    expect(settled).toMatchObject({
      status: "unanswered",
      reason: "model_error",
      detail: "Invalid request",
    });
    const tasks = await harness.commit(
      (tx) => tx.scanTasks({ conversationId: root.id }, 10),
      context,
    );
    expect(tasks.items[0]!.state).toMatchObject({
      outcome: {
        status: "failed",
        error: { message: "Invalid request", detail: { reason: "model_error" } },
      },
    });
    await harness.close(context);
  });
});

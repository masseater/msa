import { rm } from "node:fs/promises";

import { type AgentEvent, CompactionTask, defineTask, UsageDoc, watchEvents } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, waitFor } from "./chat-support.ts";
import {
  text,
  summary,
  gated,
  history,
  sqlitePath,
  directories,
  first,
  MANUAL,
  reopen,
  OVERFLOW,
  live,
  failure,
  firstUserText,
  open,
  result,
  kinds,
} from "./harness-compaction-support.ts";
import { addHooks, addTask } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { aborted, type Deferred, deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("compaction estimates and interactions", () => {
  it("settles stale in a fork reset while it summarizes", async () => {
    const chat = await open();
    await history(chat);
    const entries = await allEntries(chat.root);
    const fork = await chat.root.fork(
      entries.at(-1)!.id,
      { ownership: { kind: "ownerless" } },
      context,
    );
    const gate = deferred();
    const reached = deferred();
    chat.faux.summaries.push(gated(gate, summary(), reached));
    const id = await fork.compact(undefined, context);
    await reached.promise;
    await fork.reset(undefined, context);
    gate.resolve();
    const outcome = await result(chat, id);
    const submission = (await chat.harness.submission(
      (outcome.status === "completed" ? outcome.result.submissionId : undefined)!,
      context,
    ))!;
    expect(await submission.status(context)).toMatchObject({
      status: "unanswered",
      reason: "stale",
    });
    expect((await fork.context(context)).head?.kind).toBe("msa.reset");
    await chat.harness.close(context);
  });
});

describe("compaction estimates and interactions", () => {
  it("places an older queued summary and the current one together when idle admission drains the inbox", async () => {
    const chat = await open();
    await history(chat);
    const gate = deferred();
    const reached = deferred();
    chat.faux.agent.push(gated(gate, failure("bad request"), reached));
    const failed = await chat.root.submit({ type: "input", content: "fails" }, context);
    await reached.promise;
    chat.faux.summaries.push(summary("OLDER"));
    const older = await result(chat, await chat.root.compact(undefined, context));
    gate.resolve();
    await failed.wait(context);
    // Idle now, with the older summary still queued; the current one queues behind it and a final boundary runs.
    chat.faux.summaries.push(summary("CURRENT"));
    const current = await result(chat, await chat.root.compact(undefined, context));
    const statuses = [];
    for await (const outcome of [older, current]) {
      const id = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
      statuses.push((await (await chat.harness.submission(id!, context))!.status(context)).status);
    }
    expect(statuses).toEqual(["done", "done"]);
    expect(firstUserText((await chat.root.context(context)).messages)).toContain("CURRENT");
    await chat.harness.close(context);
  });
});

describe("compaction estimates and interactions", () => {
  it("places a hook's summary and holds while work the hook created runs", async () => {
    const chat = await open();
    const childGate = deferred();
    const Child = defineChildTask(childGate);
    addTask(chat.setup.registry, Child);
    addHooks(chat.setup.registry, CompactionTask, {
      beforeCompact: async (_compaction, api, hookContext) => {
        await chat.harness.commit(async (tx) => {
          await tx.createTask(
            Child,
            {},
            { ownership: { kind: "task", taskId: api.taskId }, conversationId: chat.root.id },
          );
        }, hookContext);
        return { summary: "HOOK" };
      },
    });
    await history(chat);
    const id = await chat.root.compact(undefined, context);
    await waitFor(
      async () => (await chat.harness.getTask(id, context))?.state.status === "completing",
    );
    // The summary and the status removal landed at the hold.
    expect((await kinds(chat.root)).at(-1)).toBe("msa.compaction");
    expect((await live(chat)).compactions).toBeUndefined();
    childGate.resolve();
    expect((await result(chat, id)).status).toBe("completed");
    await chat.harness.close(context);
  });

  it("removes the status of a faulted compaction", async () => {
    const chat = await open();
    await history(chat);
    const getModel = chat.setup.models.getModel.bind(chat.setup.models);
    chat.setup.models.getModel = () => {
      throw new Error("models broke");
    };
    const outcome = await result(chat, await chat.root.compact(undefined, context));
    chat.setup.models.getModel = getModel;
    expect(outcome).toMatchObject({ status: "faulted", error: { message: "models broke" } });
    expect((await live(chat)).compactions).toBeUndefined();
    await chat.harness.close(context);
  });
});

function defineChildTask(gate: Deferred) {
  return defineTask<Record<string, never>, { phase: "run" }, null>({
    name: "test.child",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: async (_task, runtime, taskContext) => {
        await gate.promise;
        await runtime.commit(
          () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
          taskContext,
        );
      },
    },
    abort: async (_task, runtime, taskContext) => {
      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "aborted" } }),
        taskContext,
      );
    },
  });
}

describe("compaction events and live status", () => {
  it("reports start and end, and the retry backoff in a late joiner's snapshot", async () => {
    const chat = await open();
    await history(chat);
    chat.setup.settings.retry = { enabled: true, maxRetries: 2, baseDelayMs: 60_000 };
    const events: AgentEvent[] = [];
    const stream = await watchEvents(chat.harness, chat.root.id, context);
    stream.start((batch) => {
      events.push(...batch);

      return Promise.resolve();
    });
    chat.faux.summaries.push(failure("overloaded"));
    const id = await chat.root.compact(undefined, context);
    await waitFor(async () => (await live(chat)).compactions?.[0]?.retry !== undefined);
    const late = await watchEvents(chat.harness, chat.root.id, context);
    expect(late.snapshot.compactions).toEqual([
      {
        taskId: id,
        reason: "manual",
        blocking: false,
        attempt: 1,
        retry: { at: expect.any(Number), error: "overloaded" },
      },
    ]);
    await late.stop();
    await chat.harness.abortTask(id, context);
    await waitFor(() => events.some((event) => event.type === "compaction_end"));
    expect(events.filter((event) => event.type.startsWith("compaction_"))).toEqual([
      { type: "compaction_start", taskId: id, reason: "manual", blocking: false },
      { type: "compaction_end", taskId: id, reason: "manual" },
    ]);
    await stream.stop();
    await chat.harness.close(context);
  });
});

describe("compaction events and live status", () => {
  it("lists concurrent compactions in task ID order", async () => {
    const chat = await open();
    await history(chat);
    const first = deferred();
    const second = deferred();
    chat.faux.summaries.push(
      gated(deferred(), summary(), first),
      gated(deferred(), summary(), second),
    );
    const a = await chat.root.compact(undefined, context);
    const b = await chat.root.compact(undefined, context);
    await Promise.all([first.promise, second.promise]);
    expect((await live(chat)).compactions?.map((status) => status.taskId)).toEqual([a, b]);
    await chat.root.abort(context);
    expect((await live(chat)).compactions).toBeUndefined();
    await chat.harness.close(context);
  });
});

describe("compaction recovery", () => {
  it("repeats nothing after reopen once the summary is placed", async () => {
    const path = await sqlitePath();
    let chat = await first(path);
    chat.faux.summaries.push(summary());
    await result(chat, await chat.root.compact(undefined, context));
    const entries = await allEntries(chat.root);
    const usage = await chat.harness.snapshot(UsageDoc, chat.root.id, context);
    await chat.harness.close(context);
    chat = await reopen(path, chat.setup, chat.faux);
    await chat.harness.waitForIdle(context);
    expect(chat.faux.summaryRequests).toHaveLength(1);
    expect(await allEntries(chat.root)).toEqual(entries);
    expect(await chat.harness.snapshot(UsageDoc, chat.root.id, context)).toEqual(usage);
    const inspection = await chat.harness.inspect(context);
    expect([inspection.tasks, inspection.submissions]).toEqual([[], []]);
    await chat.harness.close(context);
  });

  it("fails an overflow run with its text when its compaction fails after reopen", async () => {
    const path = await sqlitePath();
    let chat = await first(path);
    chat.setup.settings.compaction = { ...MANUAL, enabled: true };
    const reached = deferred();
    chat.faux.summaries.push(gated(deferred(), summary(), reached));
    chat.faux.agent.push(failure(OVERFLOW));
    const input = await chat.root.submit({ type: "input", content: text("u4", 100) }, context);
    await reached.promise;
    const generation = (await live(chat)).run!.taskId;
    expect((await chat.harness.getTask(generation, context))?.state).toMatchObject({
      status: "waiting",
      checkpoint: { phase: "prepare", overflow: OVERFLOW },
    });
    await chat.harness.close(context);
    chat = await reopen(path, chat.setup, chat.faux);
    chat.faux.summaries.push(failure("bad request"));
    const settled = await (await chat.harness.submission(input.id, context))!.wait(context);
    expect(settled).toMatchObject({
      status: "unanswered",
      reason: "model_error",
      detail: OVERFLOW,
    });
    await chat.harness.close(context);
  });
});

describe("compaction recovery", () => {
  it("reruns select and its hook after a crash in select", async () => {
    const path = await sqlitePath();
    let chat = await first(path);
    let calls = 0;
    const reached = deferred();
    addHooks(chat.setup.registry, CompactionTask, {
      beforeCompact: async (_compaction, _api, hookContext) => {
        calls++;
        if (calls === 1) {
          reached.resolve();
          await aborted(hookContext.abortSignal!);
        }
        return undefined;
      },
    });
    const id = await chat.root.compact(undefined, context);
    await reached.promise;
    await chat.harness.close(context);
    chat = await reopen(path, chat.setup, chat.faux);
    chat.faux.summaries.push(summary());
    expect((await result(chat, id)).status).toBe("completed");
    expect(calls).toBe(2);
    await chat.harness.close(context);
  });
});

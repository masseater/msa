import { join } from "node:path";

import { fauxAssistantMessage, fauxText } from "@msa/ai";
import { type ConversationId, configure, defineDoc, defineTask, type EntryId } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { chatSetup, openChat } from "./chat-support.ts";
import { directories, gates, runs, gated } from "./harness-ownership-support.ts";
import { addTask } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { makeTempDir, removeDir } from "./temp-support.ts";

afterEach(async () => {
  gates.clear();
  runs.clear();
  for await (const directory of directories) await removeDir(directory);
  directories.clear();
});

async function supervisorSetup() {
  const directory = await makeTempDir("msa-durable-supervisor-");
  directories.add(directory);
  const path = join(directory, "session.sqlite");
  const Children = defineDoc<{ child?: ConversationId }>({
    kind: "test.children",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: () => ({}),
  });
  const Supervisor = defineTask<{ parent: ConversationId }, { phase: "run" }, { answer: EntryId }>({
    name: "test.supervisor",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: async (task, runtime, ctx) => {
        const id = (await runtime.snapshot(Children, task.input.parent, ctx))!.child!;
        const child = (await runtime.conversation(id, ctx))!;
        const submission = await child.submit(
          { type: "input", content: "work", requestId: "stable" },
          ctx,
        );
        const settled = await submission.wait(ctx);
        if (settled.status !== "done" || settled.type !== "input") throw new Error(settled.status);
        await runtime.commit(
          () => ({
            status: "terminal",
            outcome: { status: "completed", result: { answer: settled.answer } },
          }),
          ctx,
        );
      },
    },
    abort: (_task, runtime, ctx) =>
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
  });
  const setup = chatSetup();
  addTask(setup.registry, Supervisor);
  const first = gated(fauxAssistantMessage([fauxText("never")]));
  setup.faux.setResponses([first.step, fauxAssistantMessage([fauxText("answer")])]);
  return { path, Children, Supervisor, setup, first };
}

describe("owned conversations from tools and supervisors", () => {
  it("lets a background supervisor resubmit after a restart without submitting twice", async () => {
    const { path, Children, Supervisor, setup, first } = await supervisorSetup();
    let opened = await openChat(await openNodeSqliteStorage(path), setup);
    const root = opened.root;
    const { supervisor, child } = await root.commit(async (tx) => {
      const supervisor = await tx.createTask(
        Supervisor,
        { parent: root.id },
        { ownership: { kind: "conversation" }, background: true },
      );
      const created = await tx.createConversation({
        ownership: { kind: "task", taskId: supervisor },
      });
      await configure(tx, created.id, { model: { provider: "faux", modelId: "faux-1" } });
      (await tx.doc(Children, root.id)).child = created.id;
      return { supervisor, child: created.id };
    }, context);
    opened.harness.resume();
    // The submission is admitted and its generation requested; then the process stops.
    await first.reached;
    await opened.harness.close(context);

    opened = await openChat(await openNodeSqliteStorage(path), setup);
    opened.harness.resume();
    const done = await opened.harness.waitForTask(supervisor, context);
    expect(done.state.outcome.status).toBe("completed");
    const childConversation = (await opened.harness.conversation(child, context))!;
    const entries = (await childConversation.entries({}, 100, undefined, context)).items;
    expect(entries.filter((entry) => entry.kind === "msa.user")).toHaveLength(1);
    // The root never waited for the background supervisor.
    await opened.root.waitForIdle(context);
    await opened.harness.close(context);
  });
});

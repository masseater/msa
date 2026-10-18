import { fauxAssistantMessage, fauxText } from "@msa/ai";
import { type ConversationId, configure, defineDoc, defineTask, type EntryId } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { directories, gates, runs, gated } from "./harness-ownership-support.ts";
import {
  chatSetup,
  openChat,
  awaited,
  addTask,
  joinPath,
  makeTempDir,
  removeDir,
  context,
} from "./support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      gates.clear();
      runs.clear();
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const supervisorSetup = Effect.fn("supervisorSetup")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const directory = yield* makeTempDir("msa-durable-supervisor-");
  directories.add(directory);
  const path = joinPath(directory, "session.sqlite");
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
      run: (task, runtime, ctx) =>
        runPromise(
          Effect.gen(function* () {
            const id = (yield* awaited(runtime.snapshot(Children, task.input.parent, ctx)))!.child!;
            const child = (yield* awaited(runtime.conversation(id, ctx)))!;
            const submission = yield* awaited(
              child.submit({ type: "input", content: "work", requestId: "stable" }, ctx),
            );
            const settled = yield* awaited(submission.wait(ctx));
            if (settled.status !== "done" || settled.type !== "input")
              throw new Error(settled.status);
            yield* awaited(
              runtime.commit(
                () => ({
                  status: "terminal",
                  outcome: { status: "completed", result: { answer: settled.answer } },
                }),
                ctx,
              ),
            );
          }),
        ),
    },
    abort: (_task, runtime, ctx) =>
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
  });
  const setup = chatSetup();
  addTask(setup.registry, Supervisor);
  const first = gated(fauxAssistantMessage([fauxText("never")]));
  setup.faux.setResponses([first.step, fauxAssistantMessage([fauxText("answer")])]);
  return { path, Children, Supervisor, setup, first };
});

const letsBackgroundSupervisor = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { path, Children, Supervisor, setup, first } = yield* supervisorSetup();
  let opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  const root = opened.root;
  const { supervisor, child } = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const supervisor = yield* awaited(
              tx.createTask(
                Supervisor,
                { parent: root.id },
                { ownership: { kind: "conversation" }, background: true },
              ),
            );
            const created = yield* awaited(
              tx.createConversation({
                ownership: { kind: "task", taskId: supervisor },
              }),
            );
            yield* awaited(
              configure(tx, created.id, { model: { provider: "faux", modelId: "faux-1" } }),
            );
            (yield* awaited(tx.doc(Children, root.id))).child = created.id;
            return { supervisor, child: created.id };
          }),
        ),
      context,
    ),
  );
  opened.harness.resume();
  yield* awaited(first.reached);
  yield* awaited(opened.harness.close(context));

  opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
  opened.harness.resume();
  const done = yield* awaited(opened.harness.waitForTask(supervisor, context));
  expect(done.state.outcome.status).toBe("completed");
  const childConversation = (yield* awaited(opened.harness.conversation(child, context)))!;
  const entries = (yield* awaited(childConversation.entries({}, 100, undefined, context))).items;
  expect(entries.filter((entry) => entry.kind === "msa.user")).toHaveLength(1);
  yield* awaited(opened.root.waitForIdle(context));
  yield* awaited(opened.harness.close(context));
});

describe("owned conversations from tools and supervisors", () => {
  it("lets a background supervisor resubmit after a restart without submitting twice", () =>
    Effect.runPromise(letsBackgroundSupervisor));
});

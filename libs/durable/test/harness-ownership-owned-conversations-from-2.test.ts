import { fauxAssistantMessage, fauxText } from "@msa/ai";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import node from "../src/storage/sqlite/node.ts";
import harnessOwnershipSupport from "./harness-ownership-support.ts";
import support from "./support.ts";

const { configure, defineDoc, defineTask } = durable;
const { openNodeSqliteStorage } = node;

const { directories, gated, gates, runs } = harnessOwnershipSupport;
const { addTask, awaited, chatSetup, context, joinPath, makeTempDir, openChat, removeDir } =
  support;

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

const supervisorSetupStep1 = Effect.fn("supervisorSetupStep1")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const directory = yield* makeTempDir("msa-durable-supervisor-");
  directories.add(directory);
  const path = joinPath(directory, "session.sqlite");
  const Children = defineDoc<{ child?: durableTypes.ConversationId }>({
    fork: "initial",
    history: "latest",
    initial: () => ({}),
    kind: "test.children",
    scope: "conversation",
    version: 1,
  });
  return { Children, path, runPromise };
});

const supervisorSetup = Effect.fn("supervisorSetup")(function* () {
  const { runPromise, path, Children } = yield* supervisorSetupStep1();
  const Supervisor = defineTask<
    { parent: durableTypes.ConversationId },
    { phase: "run" },
    { answer: durableTypes.EntryId }
  >({
    abort: (_task, runtime, ctx) =>
      runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), ctx),
    initial: () => ({ phase: "run" }),
    name: "test.supervisor",
    phases: {
      run: (task, runtime, ctx) =>
        runPromise(
          Effect.gen(function* () {
            const id = (yield* awaited(runtime.snapshot(Children, task.input.parent, ctx)))!.child!;
            const child = (yield* awaited(runtime.conversation(id, ctx)))!;
            const submission = yield* awaited(
              child.submit({ content: "work", requestId: "stable", type: "input" }, ctx),
            );
            const settled = yield* awaited(submission.wait(ctx));
            if (settled.status !== "done" || settled.type !== "input")
              throw new Error(settled.status);
            yield* awaited(
              runtime.commit(
                () => ({
                  outcome: { result: { answer: settled.answer }, status: "completed" },
                  status: "terminal",
                }),
                ctx,
              ),
            );
          }),
        ),
    },
    version: 1,
  });
  const setup = chatSetup();
  addTask(setup.registry, Supervisor);
  const first = gated(fauxAssistantMessage([fauxText("never")]));
  setup.faux.setResponses([first.step, fauxAssistantMessage([fauxText("answer")])]);
  return { Children, Supervisor, first, path, setup };
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
            const supervisorInner = yield* awaited(
              tx.createTask(
                Supervisor,
                { parent: root.id },
                { background: true, ownership: { kind: "conversation" } },
              ),
            );
            const created = yield* awaited(
              tx.createConversation({
                ownership: { kind: "task", taskId: supervisorInner },
              }),
            );
            yield* awaited(
              configure(tx, created.id, { model: { modelId: "faux-1", provider: "faux" } }),
            );
            (yield* awaited(tx.doc(Children, root.id))).child = created.id;
            return { child: created.id, supervisor: supervisorInner };
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

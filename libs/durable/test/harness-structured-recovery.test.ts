import { fauxAssistantMessage, fauxText, Type } from "@msa/ai";
import { defineTool, type TaskId } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { toolCalls } from "./harness-structured-events.ts";
import { seed, COMPLETED } from "./harness-structured-recovery-cases.ts";
import {
  state,
  outcomeOf,
  open,
  gates,
  until,
  start,
  behaviors,
  log,
  openNodes,
  parentOf,
  directories,
  sqlitePath,
} from "./harness-structured-support.ts";
import {
  allEntries,
  chatSetup,
  openChat,
  awaited,
  addTool,
  removeDir,
  context,
} from "./support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      behaviors.clear();
      gates.clear();
      log.length = 0;
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const FAILED = {
  status: "terminal",
  outcome: { status: "failed", error: { message: "declined" } },
};

const resumesParentAwaited = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const { parent, children } = yield* seed(path, ["c1"], (set, { parent, children }) =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited(set(children[0]!, { state: COMPLETED }));
        yield* awaited(
          set(parent, {
            state: {
              status: "waiting",
              checkpoint: { phase: "resume", round: 1 },
              on: children,
              policy: "allSettled",
            },
          }),
        );
      }),
    ),
  );
  const { harness } = yield* openNodes(yield* awaited(openNodeSqliteStorage(path)));
  expect(yield* awaited(outcomeOf(harness, parent))).toBe("completed");
  expect(log).toEqual(["resume:parent"]);
  expect(children).toHaveLength(1);
  yield* awaited(harness.close(context));
});

const marksFailFastSiblings = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const { parent, children } = yield* seed(path, ["c1", "c2"], (set, { parent, children }) =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited(set(children[0]!, { state: FAILED }));
        yield* awaited(
          set(parent, {
            state: {
              status: "waiting",
              checkpoint: { phase: "resume", round: 1 },
              on: children,
              policy: "failFast",
            },
          }),
        );
      }),
    ),
  );
  const { harness } = yield* openNodes(yield* awaited(openNodeSqliteStorage(path)));
  expect(yield* awaited(outcomeOf(harness, children[1]!))).toBe("aborted");
  expect(yield* awaited(outcomeOf(harness, parent))).toBe("completed");
  expect(log).not.toContain("run:c2");
  yield* awaited(harness.close(context));
});

describe("recovery", () => {
  it("resumes a parent whose awaited children finished before the crash", () =>
    Effect.runPromise(resumesParentAwaited));

  it("marks failFast siblings a crash left unmarked", () =>
    Effect.runPromise(marksFailFastSiblings));
});

const finalizesHeldOutcome = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const held = { status: "completing", outcome: { status: "completed", result: "parent" } };
  const { parent, children } = yield* seed(path, ["c1"], (set, { parent }) =>
    runPromise(Effect.asVoid(Effect.suspend(() => awaited(set(parent, { state: held }))))),
  );
  let opened = yield* openNodes(yield* awaited(openNodeSqliteStorage(path)));
  yield* until(() => log.includes("run:c1"));
  expect(yield* state(opened.harness, parent)).toEqual(held);
  yield* awaited(opened.harness.close(context));

  opened = yield* openNodes(yield* awaited(openNodeSqliteStorage(path)));
  open("c1");
  expect(yield* awaited(outcomeOf(opened.harness, children[0]!))).toBe("completed");
  expect(yield* awaited(outcomeOf(opened.harness, parent))).toBe("completed");
  yield* awaited(opened.harness.close(context));

  const drained = yield* sqlitePath();
  const second = yield* seed(drained, ["c1"], (set, { parent, children }) =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited(set(children[0]!, { state: COMPLETED }));
        yield* awaited(set(parent, { state: held }));
      }),
    ),
  );
  opened = yield* openNodes(yield* awaited(openNodeSqliteStorage(drained)));
  expect(yield* awaited(outcomeOf(opened.harness, second.parent))).toBe("completed");
  yield* awaited(opened.harness.close(context));
});

const resumesBottomUp = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const { parent, children } = yield* seed(path, ["c1"], (set, { parent, children }) =>
    runPromise(
      Effect.asVoid(
        Effect.suspend(() =>
          awaited(
            set(parent, {
              abortRequested: true,
              state: {
                status: "waiting",
                checkpoint: { phase: "resume", round: 1 },
                on: children,
                policy: "allSettled",
              },
            }),
          ),
        ),
      ),
    ),
  );
  const { harness } = yield* openNodes(yield* awaited(openNodeSqliteStorage(path)));
  expect(yield* awaited(outcomeOf(harness, parent))).toBe("aborted");
  expect(yield* awaited(outcomeOf(harness, children[0]!))).toBe("aborted");
  expect(log.filter((line) => line.startsWith("abort:"))).toEqual(["abort:c1", "abort:parent"]);
  yield* awaited(harness.close(context));
});

describe("recovery", () => {
  it("finalizes a held outcome whose work drained before the crash, and keeps one whose work lives", () =>
    Effect.runPromise(finalizesHeldOutcome));

  it("resumes a bottom-up abort a crash interrupted before the cascade", () =>
    Effect.runPromise(resumesBottomUp));
});

const reopensCheckoutWaiting = Effect.gen(function* () {
  const path = yield* sqlitePath();
  const found = parentOf("checkout", ["p1", "p2"], "failFast");
  let opened = yield* openNodes(yield* awaited(openNodeSqliteStorage(path)));
  const parent = yield* awaited(start(opened.root, "checkout"));
  yield* until(
    Effect.gen(function* () {
      return (yield* state(opened.harness, parent)).status === "waiting";
    }),
  );
  yield* until(() => log.includes("run:p1") && log.includes("run:p2"));
  yield* awaited(opened.harness.close(context));

  opened = yield* openNodes(yield* awaited(openNodeSqliteStorage(path)));
  found.ids.splice(
    0,
    found.ids.length,
    ...((yield* state(opened.harness, parent)) as unknown as { on: TaskId<string>[] }).on,
  );
  open("p1");
  open("p2");
  expect(yield* awaited(outcomeOf(opened.harness, parent))).toBe("completed");
  expect(found.outcomes).toEqual(["completed", "completed"]);
  yield* awaited(opened.harness.close(context));
});

describe("recovery", () => {
  it("reopens a checkout waiting on live payments and finishes it", () =>
    Effect.runPromise(reopensCheckoutWaiting));
});

const ownsToolTasks = Effect.gen(function* () {
  const setup = chatSetup();
  addTool(
    setup.registry,
    defineTool({
      name: "noop",
      description: "Does nothing",
      parameters: Type.Object({}),
      execute: () => Promise.resolve({ output: [] }),
    }),
  );
  setup.faux.setResponses([
    toolCalls(["noop", "c1"], ["noop", "c2"]),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  expect(
    (yield* awaited(
      (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
    )).status,
  ).toBe("done");
  const tasks = (yield* awaited(
    harness.commit((tx) => tx.scanTasks({ conversationId: root.id }, 20), context),
  )).items;
  const [first, second] = tasks.filter((task) => task.kind === "msa.generation");
  expect(tasks.filter((task) => task.kind === "msa.tool").map((task) => task.owner)).toEqual([
    first!.id,
    first!.id,
  ]);
  expect(first!.owner).toBeUndefined();
  expect(second!.owner).toBeUndefined();
  const assistant = (yield* allEntries(root)).find((entry) => entry.kind === "msa.assistant")!;
  expect(first!.state).toEqual({
    status: "terminal",
    outcome: { status: "completed", result: { entryId: assistant.id } },
  });
  yield* awaited(harness.close(context));
});

describe("tool rounds", () => {
  it("owns its tool tasks, waits for them, and hands the run to a conversation-owned generation", () =>
    Effect.runPromise(ownsToolTasks));
});

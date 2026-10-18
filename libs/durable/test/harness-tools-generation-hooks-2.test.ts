import { configure, defineTask } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { resultText, results, DONE, calls, run, tool } from "./harness-tools-support.ts";
import { chatSetup, openChat, awaited, addTask, addTool, context } from "./support.ts";

function probingToolSetup() {
  const setup = chatSetup();
  const child = defineTask<{ n: number }, { phase: "run" }, number>({
    name: "test.child",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: (task, runtime, callContext) =>
        Effect.runPromise(
          Effect.asVoid(
            Effect.suspend(() =>
              awaited(
                runtime.commit(
                  () => ({
                    status: "terminal",
                    outcome: { status: "completed", result: task.input.n * 2 },
                  }),
                  callContext,
                ),
              ),
            ),
          ),
        ),
    },
    abort: () => Promise.resolve(),
  });
  addTask(setup.registry, child);
  const seen: unknown[] = [];
  const probe = tool("probe", (_args, api) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        seen.push(api.env?.cwd);
        seen.push((yield* awaited(api.agent(context))).tools.map((each) => each.name));
        seen.push(api.registry.extension("tool:probe") !== undefined);
        const entry = yield* awaited(
          api.commit(
            (tx) =>
              runPromise(
                Effect.gen(function* () {
                  yield* awaited(configure(tx, api.conversationId, { cwd: "/" }));
                  return yield* awaited(
                    tx.appendEntry(api.conversationId, {
                      kind: "test.note",
                      data: api.callId,
                    }),
                  );
                }),
              ),
            context,
          ),
        );
        seen.push(entry.byTaskId === api.taskId);
        seen.push(
          yield* awaited(api.memo("m", 1, context)),
          yield* awaited(api.memo("m", 2, context)),
        );
        const id = yield* awaited(
          api.createTask(child, { n: 21 }, { ownership: { kind: "conversation" } }, context),
        );
        const done = yield* awaited(api.waitForTask(id, context));
        seen.push(done.state.outcome);
        return { output: [] };
      }),
    ),
  );
  addTool(setup.registry, probe);
  return { setup, seen };
}

const buildsEnvironmentPer = Effect.gen(function* () {
  const { setup, seen } = probingToolSetup();
  setup.faux.setResponses([calls(["probe", {}, "c1"], ["probe", {}, "c2"]), DONE]);
  setup.settings.toolExecution = "sequential";
  const targets: unknown[] = [];
  const { harness, root } = yield* openChat(new MemoryStorage(), setup, {
    env: ({ conversationId, cwd }) => {
      targets.push([conversationId, cwd]);
      return new NodeExecutionEnv({ cwd: cwd ?? "/tmp" });
    },
  });
  yield* awaited(root.configure({ cwd: "/tmp" }, context));
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  const outcome = { status: "completed", result: 42 };
  const call = (cwd: string) => [cwd, ["probe"], true, true, 1, 1, outcome];
  expect(seen).toEqual([...call("/tmp"), ...call("/")]);
  expect(targets).toContainEqual([root.id, "/tmp"]);
  expect(targets).toContainEqual([root.id, "/"]);
  yield* awaited(harness.close(context));
});

const answersThrowingEnvironment = Effect.gen(function* () {
  const setup = chatSetup();
  addTool(
    setup.registry,
    tool("probe", () => Promise.resolve({ output: [{ type: "text", text: "ran" }] })),
  );
  const { harness, entries } = yield* run(setup, [calls(["probe", {}, "c1"]), DONE], undefined, {
    env: () => {
      throw new Error("no sandbox");
    },
  });
  const [result] = results(entries);
  expect(result).toMatchObject({ isError: true });
  expect(resultText(result!)).toBe("<harness>\n[error] no sandbox\n</harness>");
  expect(setup.reports.filter((error) => (error as Error).message === "no sandbox").length).toBe(2);
  yield* awaited(harness.close(context));
});

describe("tool execution api", () => {
  it("builds the environment per call from the conversation's cwd and runs commits, memos, and child tasks", () =>
    Effect.runPromise(buildsEnvironmentPer));

  it("answers a throwing environment with a tool_error result and reports it once while preparing", () =>
    Effect.runPromise(answersThrowingEnvironment));
});

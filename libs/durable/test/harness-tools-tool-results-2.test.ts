import { AgentDoc, defineExtension, defineTask, hook } from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { addTool } from "./harness-support.ts";
import { DONE, calls, run, tool } from "./harness-tools-support.ts";
import { context } from "./session-support.ts";

function selectedHookExtensions() {
  const setup = chatSetup();
  const calledIn: number[] = [];
  const Echo = defineExtension({
    name: "echo",
    tools: [tool("echo", () => Promise.resolve({ output: [] }))],
  });
  const Audit = defineExtension({
    name: "audit",
    hooks: [hook(ToolTask, { beforeTool: (_call, api) => void calledIn.push(api.conversationId) })],
  });
  setup.registry.install(Echo);
  setup.registry.install(Audit);
  return { setup, calledIn, Echo, Audit };
}

const runsHooksSelectedStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { setup, calledIn, Echo, Audit } = selectedHookExtensions();
  setup.settings.extensions = [Echo];
  const first = yield* run(setup, [DONE]);
  yield* awaited(first.root.configure({ extensions: { add: [Audit] } }, context));
  const owner = defineTask<Record<string, never>, { phase: "never" }, null>({
    name: "test.owner",
    version: 1,
    initial: () => ({ phase: "never" }),
    phases: { never: () => Promise.resolve() },
    abort: () => Promise.resolve(),
  });
  const childId = yield* awaited(
    first.harness.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const taskId = yield* awaited(
              tx.createTask(
                owner,
                {},
                { ownership: { kind: "conversation" }, conversationId: first.root.id },
              ),
            );
            return (yield* awaited(tx.createConversation({ ownership: { kind: "task", taskId } })))
              .id;
          }),
        ),
      context,
    ),
  );
  const child = (yield* awaited(first.harness.conversation(childId, context)))!;
  const other = yield* awaited(
    first.harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: { provider: "faux", modelId: "faux-1" } },
      },
      context,
    ),
  );
  return { setup, calledIn, first, child, other };
});

const runsHooksSelected = Effect.gen(function* () {
  const { setup, calledIn, first, child, other } = yield* runsHooksSelectedStep1;
  for (const conversation of [first.root, child, other]) {
    setup.faux.setResponses([calls(["echo", {}, "c1"]), DONE]);
    yield* awaited(
      (yield* awaited(conversation.submit({ type: "input", content: "go" }, context))).wait(
        context,
      ),
    );
  }
  expect(calledIn).toEqual([first.root.id, child.id]);
  yield* awaited(first.harness.close(context));
});

describe("tool results", () => {
  it("runs the hooks of the selected extensions; a task-owned child copies its owner's selection", () =>
    Effect.runPromise(runsHooksSelected));
});

const appliesAddToolsTerminates = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const stop = tool("stop", () => Promise.resolve({ output: [], control: { terminate: true } }));
  const grow = tool("grow", () =>
    Promise.resolve({
      output: [],
      control: { addTools: ["extra", "stop"] },
    }),
  );
  addTool(setup.registry, stop);
  addTool(setup.registry, grow);
  addTool(
    setup.registry,
    tool("extra", () => Promise.resolve({ output: [] })),
  );
  const first = yield* run(setup, [calls(["stop", {}, "c1"])], (_harness, root) =>
    runPromise(
      Effect.asVoid(
        Effect.suspend(() => awaited(root.configure({ tools: [stop, grow] }, context))),
      ),
    ),
  );
  expect(first.status).toBe("done");
  expect(first.entries.at(-1)!.kind).toBe("msa.tool-result");
  const settled = yield* awaited(
    first.harness.commit((tx) => tx.scanTasks({ conversationId: first.root.id }, 20), context),
  );
  expect(settled.items.every((task) => task.state.status === "terminal")).toBe(true);

  setup.faux.setResponses([calls(["stop", {}, "c1"], ["grow", {}, "c2"]), DONE]);
  const second = yield* awaited(
    (yield* awaited(first.root.submit({ type: "input", content: "again" }, context))).wait(context),
  );
  expect(second.status).toBe("done");
  expect((yield* allEntries(first.root)).at(-1)!.kind).toBe("msa.assistant");
  expect((yield* awaited(first.harness.snapshot(AgentDoc, first.root.id, context)))?.tools).toEqual(
    ["stop", "grow", "extra"],
  );
  yield* awaited(first.harness.close(context));
});

describe("tool results", () => {
  it("applies addTools and terminates only when every result of the round asks to", () =>
    Effect.runPromise(appliesAddToolsTerminates));
});

import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import harnessSupport from "./harness-support.ts";
import harnessToolsSupport from "./harness-tools-support.ts";
import sessionSupport from "./session-support.ts";

const { AgentDoc, defineExtension, defineTask, hook } = durable;
const { ToolTask } = harnessModule;

const { allEntries, chatSetup } = chatSupport;
const { awaited } = effectSupport;
const { addTool } = harnessSupport;
const { DONE, calls, run, tool } = harnessToolsSupport;
const { context } = sessionSupport;

function selectedHookExtensions() {
  const setup = chatSetup();
  const calledIn: number[] = [];
  const Echo = defineExtension({
    name: "echo",
    tools: [tool("echo", () => Promise.resolve({ output: [] }))],
  });
  const Audit = defineExtension({
    hooks: [hook(ToolTask, { beforeTool: (_call, api) => void calledIn.push(api.conversationId) })],
    name: "audit",
  });
  setup.registry.install(Echo);
  setup.registry.install(Audit);
  return { Audit, Echo, calledIn, setup };
}

const runsHooksSelectedStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { setup, calledIn, Echo, Audit } = selectedHookExtensions();
  setup.settings.extensions = [Echo];
  const first = yield* run(setup, [DONE]);
  yield* awaited(first.root.configure({ extensions: { add: [Audit] } }, context));
  const owner = defineTask<Record<string, never>, { phase: "never" }, null>({
    abort: () => Promise.resolve(),
    initial: () => ({ phase: "never" }),
    name: "test.owner",
    phases: { never: () => Promise.resolve() },
    version: 1,
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
                { conversationId: first.root.id, ownership: { kind: "conversation" } },
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
        agent: { model: { modelId: "faux-1", provider: "faux" } },
        ownership: { kind: "ownerless" },
      },
      context,
    ),
  );
  return { calledIn, child, first, other, setup };
});

const runsHooksSelected = Effect.gen(function* () {
  const { setup, calledIn, first, child, other } = yield* runsHooksSelectedStep1;
  for (const conversation of [first.root, child, other]) {
    setup.faux.setResponses([calls(["echo", {}, "c1"]), DONE]);
    yield* awaited(
      (yield* awaited(conversation.submit({ content: "go", type: "input" }, context))).wait(
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
  const stop = tool("stop", () => Promise.resolve({ control: { terminate: true }, output: [] }));
  const grow = tool("grow", () =>
    Promise.resolve({
      control: { addTools: ["extra", "stop"] },
      output: [],
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
    (yield* awaited(first.root.submit({ content: "again", type: "input" }, context))).wait(context),
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

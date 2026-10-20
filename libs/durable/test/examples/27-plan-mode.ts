import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Type, createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@msa/ai";
import contextModule from "@msa/chord/context";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import memory from "@msa/durable/storage/memory";
import { Console, Effect } from "effect";

import node from "../../src/env/node.ts";
import toolsModule from "../../src/tools/index.ts";
import support from "../support.ts";

const { BACKGROUND_CONTEXT } = contextModule;

const { defineDoc, defineExtension, defineTool, section } = durable;
const { CodingTools, createReadTool } = toolsModule;
const { Harness, createRegistry } = harnessModule;
const { MemoryStorage } = memory;
const { NodeExecutionEnv } = node;

const { awaited, joinPath, makeTempDir, removeDir, writeText } = support;

const context = BACKGROUND_CONTEXT;

const PlanDoc = defineDoc<{ steps: string[] }>({
  fork: "asOf",
  history: "rewindable",
  initial: () => ({ steps: [] }),
  kind: "app.plan",
  scope: "conversation",
  version: 1,
});

const submitPlan = defineTool({
  description: "Submit the plan as a list of steps.",
  execute: (args, api, callContext) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* awaited(
          api.commit(
            (tx) =>
              runPromise(
                Effect.gen(function* () {
                  (yield* awaited(tx.doc(PlanDoc, api.conversationId))).steps = args.steps;
                }),
              ),
            callContext,
          ),
        );
        return {
          control: { terminate: true },
          output: [{ text: "Plan submitted.", type: "text" }],
        };
      }),
    ),
  name: "submit_plan",
  parameters: Type.Object({ steps: Type.Array(Type.String()) }),
});

const Plan = defineExtension({
  name: "plan",
  sections: [
    section(
      "plan_mode",
      () => "You are in plan mode. Read the code, then call submit_plan. Change nothing.",
    ),
  ],
  tools: [submitPlan],
});

const read = createReadTool();
const enterPlanMode = { extensions: { add: [Plan] }, tools: [read, submitPlan] };
const leavePlanMode = { extensions: null, tools: null };

const mainStep1 = Effect.gen(function* () {
  const directory = yield* makeTempDir("msa-durable-plan-");
  yield* writeText(joinPath(directory, "server.ts"), "app.listen(3000);\n");

  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read", { path: "server.ts" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("submit_plan", {
        steps: ["Read PORT from the environment", "Default to 3000"],
      }),
      {
        stopReason: "toolUse",
      },
    ),
    fauxAssistantMessage("Implementing step 1."),
  ]);

  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(Plan);
  const harness = yield* awaited(
    Harness.open(
      new MemoryStorage(),
      {
        env: () => new NodeExecutionEnv({ cwd: directory }),
        models,
        registry,
        settings: { extensions: [CodingTools] },
      },
      context,
    ),
  );
  const root = yield* awaited(
    harness.root(context, {
      agent: { model: { modelId: "faux-1", provider: "faux" } },
    }),
  );
  return { directory, harness, root };
});

const main = Effect.gen(function* () {
  const { directory, harness, root } = yield* mainStep1;
  const tools = Effect.fn("tools")(function* () {
    return (yield* awaited(root.agent(context))).tools.map((tool) => tool.name);
  });
  yield* Console.log("tools:", yield* tools());

  yield* awaited(root.configure(enterPlanMode, context));
  yield* Console.log("plan mode tools:", yield* tools());
  yield* awaited(
    (yield* awaited(
      root.submit({ content: "Make the port configurable.", type: "input" }, context),
    )).wait(context),
  );
  yield* Console.log("plan:", (yield* awaited(harness.snapshot(PlanDoc, root.id, context)))?.steps);

  yield* awaited(root.configure(leavePlanMode, context));
  yield* Console.log("tools again:", yield* tools());
  yield* awaited(
    (yield* awaited(root.submit({ content: "Go ahead.", type: "input" }, context))).wait(context),
  );

  const { messages } = yield* awaited(root.context(context));
  for (const message of messages) {
    if (message.role !== "system") continue;
    yield* Console.log("system:", {
      added: message.toolsAdded?.map((tool) => tool.name),
      removed: message.toolsRemoved?.map((tool) => tool.name),
      sections: message.sections,
    });
  }

  yield* awaited(harness.close(context));
  yield* removeDir(directory);
});

NodeRuntime.runMain(main);

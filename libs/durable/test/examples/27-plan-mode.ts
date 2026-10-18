import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Type } from "@msa/ai";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@msa/ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { NodeExecutionEnv } from "../../src/env/node.ts";
import { createRegistry, Harness } from "../../src/harness/index.ts";
import { defineDoc, defineExtension, defineTool, section } from "../../src/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import { CodingTools, createReadTool } from "../../src/tools/index.ts";
import { awaited } from "../effect-support.ts";
import { joinPath, makeTempDir, removeDir, writeText } from "../platform-support.ts";

const context = BACKGROUND_CONTEXT;

const PlanDoc = defineDoc<{ steps: string[] }>({
  kind: "app.plan",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ steps: [] }),
});

const submitPlan = defineTool({
  name: "submit_plan",
  description: "Submit the plan as a list of steps.",
  parameters: Type.Object({ steps: Type.Array(Type.String()) }),
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
          output: [{ type: "text", text: "Plan submitted." }],
          control: { terminate: true },
        };
      }),
    ),
});

const Plan = defineExtension({
  name: "plan",
  tools: [submitPlan],
  sections: [
    section(
      "plan_mode",
      () => "You are in plan mode. Read the code, then call submit_plan. Change nothing.",
    ),
  ],
});

const read = createReadTool();
const enterPlanMode = { extensions: { add: [Plan] }, tools: [read, submitPlan] };
const leavePlanMode = { extensions: null, tools: null };

const main = Effect.gen(function* () {
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
        models,
        registry,
        settings: { extensions: [CodingTools] },
        env: () => new NodeExecutionEnv({ cwd: directory }),
      },
      context,
    ),
  );
  const root = yield* awaited(
    harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    }),
  );
  const tools = Effect.fn("tools")(function* () {
    return (yield* awaited(root.agent(context))).tools.map((tool) => tool.name);
  });
  yield* Console.log("tools:", yield* tools());

  yield* awaited(root.configure(enterPlanMode, context));
  yield* Console.log("plan mode tools:", yield* tools());
  yield* awaited(
    (yield* awaited(
      root.submit({ type: "input", content: "Make the port configurable." }, context),
    )).wait(context),
  );
  yield* Console.log("plan:", (yield* awaited(harness.snapshot(PlanDoc, root.id, context)))?.steps);

  yield* awaited(root.configure(leavePlanMode, context));
  yield* Console.log("tools again:", yield* tools());
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "Go ahead." }, context))).wait(context),
  );

  const { messages } = yield* awaited(root.context(context));
  for (const message of messages) {
    if (message.role !== "system") continue;
    yield* Console.log("system:", {
      sections: message.sections,
      added: message.toolsAdded?.map((tool) => tool.name),
      removed: message.toolsRemoved?.map((tool) => tool.name),
    });
  }

  yield* awaited(harness.close(context));
  yield* removeDir(directory);
});

NodeRuntime.runMain(main);

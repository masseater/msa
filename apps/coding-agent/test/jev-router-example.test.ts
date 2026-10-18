import type { AgentTool } from "@msa/agent-core";
import {
  type AssistantMessage,
  type ClassifierModel,
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@msa/ai";
import { awaited, runTest, currentTimeMillis } from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import jevRouter from "../examples/extensions/jev-router.ts";
import {
  VIRTUAL_MODEL_STATE_ENTRY,
  type VirtualModelStateData,
} from "../src/core/virtual-models.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

function createTool(name: string, fails = false): AgentTool {
  return {
    name,
    label: name,
    description: `Fake ${name} tool`,
    parameters: Type.Object({ path: Type.String() }),
    execute: () =>
      runTest(
        Effect.gen(function* () {
          if (fails) throw new Error(`${name} failed`);
          return yield* awaited({
            content: [{ type: "text" as const, text: `${name} ok` }],
            details: {},
          });
        }),
      ),
  };
}

const jevModel: ClassifierModel<string> = {
  type: "classifier" as const,
  id: "~typesafe/jev-latest",
  name: "Jev",
  api: "typesafe-system-one" as const,
  provider: "openrouter",
  baseUrl: "",
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 64_000,
};

describe("jev-router example", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.cleanup();
  });

  function setup(complex: number, tools: AgentTool[]) {
    return runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const codex = fauxProvider({
          provider: "openai-codex",
          models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].map((id) => ({
            id,
            reasoning: true,
          })),
        });
        const openrouter = createProvider({
          id: "openrouter",
          auth: {
            apiKey: { name: "OpenRouter", resolve: () => effectRunPromise(awaited({ auth: {} })) },
          },
          models: [jevModel],
          classifiers: {
            "typesafe-system-one": {
              classify: (model) =>
                effectRunPromise(
                  awaited({
                    api: model.api,
                    provider: model.provider,
                    model: model.id,
                    answers: {
                      complexity: {
                        type: "choice" as const,
                        choice: complex >= 0.5 ? "complex" : "standard",
                        probabilities: { standard: 1 - complex, complex },
                        confidence: Math.max(complex, 1 - complex),
                      },
                    },
                    stopReason: "stop",
                    timestamp: currentTimeMillis(),
                  }),
                ),
            },
          },
        });
        const harness = yield* awaited(
          createHarness({
            tools,
            extensionFactories: [
              (msa) => {
                msa.registerProvider(codex.provider);
                msa.registerProvider(openrouter);
              },
              jevRouter,
            ],
          }),
        );
        harnesses.push(harness);
        const runtime = harness.session.modelRuntime;
        harness.session.agent.streamFunction = (model, context, options) =>
          runtime.streamSimple(model, context, options);
        yield* awaited(runtime.refresh({ allowNetwork: false }));
        yield* awaited(harness.session.setModel(runtime.getModel("jev", "auto")!));

        const respond = (...messages: AssistantMessage[]) => codex.appendResponses(messages);
        const dispatched = () =>
          harness.session.messages.flatMap((m) =>
            m.role === "assistant" ? [m.model.replace("gpt-5.6-", "")] : [],
          );
        const phases = () =>
          harness.sessionManager
            .getBranch()
            .flatMap((entry) =>
              entry.type === "custom" && entry.customType === VIRTUAL_MODEL_STATE_ENTRY
                ? [(entry.data as VirtualModelStateData<{ phase: string }>).state.phase]
                : [],
            );
        return yield* awaited({ harness, dispatched, respond, phases });
      }),
    );
  }

  const call = (tool: string) =>
    fauxAssistantMessage(fauxToolCall(tool, { path: "a.ts" }), { stopReason: "toolUse" });

  it("lets Sol make the first edit and switches to Luna for the rest", () =>
    runTest(
      Effect.gen(function* () {
        const { harness, dispatched, respond, phases } = yield* awaited(
          setup(0.8, [createTool("read"), createTool("edit")]),
        );

        respond(call("read"), call("edit"), fauxAssistantMessage("done"));
        yield* awaited(harness.session.prompt("Refactor the cache layer."));
        respond(fauxAssistantMessage("added"));
        yield* awaited(harness.session.prompt("Also add tests."));

        expect(dispatched()).toEqual(["sol", "sol", "luna", "luna"]);
        expect(phases()).toEqual(["planning", "implementation"]);
        expect(harness.session.model).toMatchObject({ provider: "jev", id: "auto" });
      }),
    ));

  it("plans on Terra and ignores failed edits", () =>
    runTest(
      Effect.gen(function* () {
        const { harness, dispatched, respond, phases } = yield* awaited(
          setup(0.2, [createTool("edit", true), createTool("write")]),
        );

        respond(call("edit"), call("write"), fauxAssistantMessage("done"));
        yield* awaited(harness.session.prompt("Add a verbose flag."));

        expect(dispatched()).toEqual(["terra", "terra", "luna"]);
        expect(phases()).toEqual(["planning", "implementation"]);
      }),
    ));
});

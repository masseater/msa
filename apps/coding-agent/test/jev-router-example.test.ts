import type { AgentTool } from "@msa/agent-core";
import {
  type AssistantMessage,
  type ClassifierModel,
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import jevRouter from "../examples/extensions/jev-router.ts";
import {
  VIRTUAL_MODEL_STATE_ENTRY,
  type VirtualModelStateData,
} from "../src/core/virtual-models.ts";
import harnessModule from "./suite/harness.ts";
import type harnessTypes from "./suite/harness.types.ts";

const { createHarness } = harnessModule;

const { awaited, currentTimeMillis, runTest } = testing;

function createTool(name: string, fails = false): AgentTool {
  return {
    description: `Fake ${name} tool`,
    execute: () =>
      runTest(
        Effect.gen(function* () {
          if (fails) throw new Error(`${name} failed`);
          return yield* awaited({
            content: [{ text: `${name} ok`, type: "text" as const }],
            details: {},
          });
        }),
      ),
    label: name,
    name,
    parameters: Type.Object({ path: Type.String() }),
  };
}

const jevModel: ClassifierModel<string> = {
  api: "typesafe-system-one" as const,
  baseUrl: "",
  contextWindow: 64_000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "~typesafe/jev-latest",
  input: ["text"],
  name: "Jev",
  provider: "openrouter",
  type: "classifier" as const,
};

const harnesses: harnessTypes.Harness[] = [];

const setupPart1 = (input: { readonly complex: number }) =>
  Effect.gen(function* () {
    const { complex } = input;
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const codex = fauxProvider({
      models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].map((id) => ({
        id,
        reasoning: true,
      })),
      provider: "openai-codex",
    });
    const openrouter = createProvider({
      auth: {
        apiKey: { name: "OpenRouter", resolve: () => effectRunPromise(awaited({ auth: {} })) },
      },
      classifiers: {
        "typesafe-system-one": {
          classify: (model) =>
            effectRunPromise(
              awaited({
                answers: {
                  complexity: {
                    choice: complex >= 0.5 ? "complex" : "standard",
                    confidence: Math.max(complex, 1 - complex),
                    probabilities: { complex, standard: 1 - complex },
                    type: "choice" as const,
                  },
                },
                api: model.api,
                model: model.id,
                provider: model.provider,
                stopReason: "stop",
                timestamp: currentTimeMillis(),
              }),
            ),
        },
      },
      id: "openrouter",
      models: [jevModel],
    });
    return { codex, openrouter };
  });

function setup(complex: number, tools: AgentTool[]) {
  return runTest(
    Effect.gen(function* () {
      const { codex, openrouter } = yield* setupPart1({ complex });
      const harness = yield* awaited(
        createHarness({
          extensionFactories: [
            (msa) => {
              msa.registerProvider(codex.provider);
              msa.registerProvider(openrouter);
            },
            jevRouter,
          ],
          tools,
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
      return yield* awaited({ dispatched, harness, phases, respond });
    }),
  );
}

const call = (tool: string) =>
  fauxAssistantMessage(fauxToolCall(tool, { path: "a.ts" }), { stopReason: "toolUse" });

const letsSolMakeTheFirstEditAnd = () =>
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
      expect(harness.session.model).toMatchObject({ id: "auto", provider: "jev" });
    }),
  );

const plansOnTerraAndIgnoresFailedEdits = () =>
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
  );

describe("jev-router example", () => {
  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.cleanup();
  });

  it("lets Sol make the first edit and switches to Luna for the rest", letsSolMakeTheFirstEditAnd);

  it("plans on Terra and ignores failed edits", plansOnTerraAndIgnoresFailedEdits);
});

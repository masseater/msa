import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";

import jevRouter from "../examples/extensions/jev-router.ts";
import codingAgent from "../src/index.ts";
import type codingAgentTypes from "../src/index.types.ts";
import jevRouterProviders from "./jev-router-providers.ts";
import harnessModule from "./suite/harness.ts";
import type harnessTypes from "./suite/harness.types.ts";

const { VIRTUAL_MODEL_STATE_ENTRY } = codingAgent;
const { createRouterProviders } = jevRouterProviders;
const { createHarness } = harnessModule;
const { awaited, runTest } = testing;

const harnesses: harnessTypes.Harness[] = [];

function setup(complex: number, tools: agentTypes.AgentTool[]) {
  return runTest(
    Effect.gen(function* () {
      const { codex, openrouter } = yield* createRouterProviders({ complex });
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
      const runtime = harness.session.models.selection.modelRuntime;
      harness.session.agent.streamFunction = (model, context, options) =>
        runtime.streamSimple(model, context, options);
      yield* awaited(runtime.refresh({ allowNetwork: false }));
      yield* awaited(harness.session.models.selection.setModel(runtime.getModel("jev", "auto")!));

      const respond = (...messages: aiTypes.AssistantMessage[]) => codex.appendResponses(messages);
      const dispatched = () =>
        harness.session.messages.flatMap((m) =>
          m.role === "assistant" ? [m.model.replace("gpt-5.6-", "")] : [],
        );
      const phases = () =>
        harness.sessionManager
          .getBranch()
          .flatMap((entry) =>
            entry.type === "custom" && entry.customType === VIRTUAL_MODEL_STATE_ENTRY
              ? [
                  (entry.data as codingAgentTypes.VirtualModelStateData<{ phase: string }>).state
                    .phase,
                ]
              : [],
          );
      return yield* awaited({ dispatched, harness, phases, respond });
    }),
  );
}

const cleanupHarnesses = () => {
  for (const harness of harnesses.splice(0)) harness.cleanup();
};

const jevRouterHarness = { cleanupHarnesses, setup };

export default jevRouterHarness;

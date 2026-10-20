import type { AgentTool } from "@msa/agent-core";
import { Effect } from "effect";
import { Type } from "typebox";

import { type ModelRouteRequest } from "../../src/core/virtual-models.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";
import type virtualModelsSupportTypes from "./virtual-models-support.types.ts";

const { createHarness } = harnessModule;

const echoTool: AgentTool = {
  description: "Echo text back",
  execute: () => Promise.resolve({ content: [{ text: "echoed", type: "text" }], details: {} }),
  label: "Echo",
  name: "echo",
  parameters: Type.Object({ text: Type.String() }),
};

const defaultRoute: virtualModelsSupportTypes.Route = (request, ctx) => {
  const find = (id: string) => ctx.modelRegistry.find("faux", id)!;
  if (request.reason === "direct") return { model: find("large"), thinkingLevel: "low" };
  const sticky = request.failed ?? request.previous;
  if (request.reason !== "user" && sticky !== undefined) {
    return { model: sticky.model, thinkingLevel: sticky.thinkingLevel ?? "high" };
  }
  return request.thinkingLevel === "high"
    ? { model: find("large"), thinkingLevel: "high" }
    : { model: find("small"), thinkingLevel: "off" };
};

const harnesses: harnessTypes.Harness[] = [];

type ExtensionFactory = NonNullable<harnessTypes.HarnessOptions["extensionFactories"]>[number];

const registerAutoRouter =
  (route: virtualModelsSupportTypes.Route, requests: ModelRouteRequest[]): ExtensionFactory =>
  (msa) => {
    msa.registerVirtualModel({
      contextWindow: 1000,
      id: "auto",
      name: "Auto",
      provider: "router",
      route(request, ctx) {
        requests.push(request);
        return route(request, ctx);
      },
      thinkingLevels: ["low", "high"],
    });
  };

const dispatchedModels = (harness: harnessTypes.Harness) =>
  harness.session.messages.flatMap((message) =>
    message.role === "assistant"
      ? [`${message.provider}/${message.model}:${message.thinkingLevel}`]
      : [],
  );

function createRoutedHarness(
  route: virtualModelsSupportTypes.Route = defaultRoute,
  options: harnessTypes.HarnessOptions = {},
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const requests: ModelRouteRequest[] = [];
      const harness = yield* Effect.promise(() =>
        createHarness({
          ...options,
          extensionFactories: [
            ...(options.extensionFactories ?? []),
            registerAutoRouter(route, requests),
          ],
          models: [
            { contextWindow: 1000, id: "small" },
            { contextWindow: 50_000, id: "large", maxTokens: 4000, reasoning: true },
          ],
          tools: [echoTool],
        }),
      );
      harnesses.push(harness);

      const runtime = harness.session.modelRuntime;
      harness.session.agent.streamFunction = (model, context, streamOptions) =>
        runtime.streamSimple(model, context, streamOptions);
      yield* Effect.promise(() => harness.session.setModel(runtime.getModel("router", "auto")!));
      harness.session.setThinkingLevel("high");
      const reasons = () => requests.map((request) => request.reason);

      const dispatched = () => dispatchedModels(harness);
      return { dispatched, harness, reasons, requests };
    }),
  );
}

const virtualModelsSupport = {
  createRoutedHarness,
  defaultRoute,
  echoTool,
  harnesses,
};

export default virtualModelsSupport;

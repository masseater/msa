import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import type { Model, SimpleStreamOptions } from "../src/types.ts";
import openaiCompletionsToolChoiceSupport from "./openai-completions-tool-choice-support.ts";

vi.mock("openai", () =>
  import("./openai-completions-tool-choice-mock.ts").then((module) => module.default),
);

const {
  directCompletionsModel,
  localOpenAICompletionsModel,
  optionalFieldTool,
  pingTool,
  promptModel,
  resetMockStateBeforeEach,
} = openaiCompletionsToolChoiceSupport;

const providerOnlyToolChoice = { toolChoice: "required" } as unknown as SimpleStreamOptions;

const forwardsToolChoice = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payload } = yield* promptModel(directCompletionsModel(), "Call ping with ok=true", {
        options: providerOnlyToolChoice,
        tools: [pingTool],
      });
      expect(payload.tool_choice).toBe("required");
      expect(payload.tools?.length ?? 0).toBeGreaterThan(0);
    }),
  );

const sendsToolChoiceWithoutTools = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payload } = yield* promptModel(
        directCompletionsModel(),
        "Summarize the conversation",
        {
          options: { toolChoice: "none" },
        },
      );
      expect(payload.tool_choice).toBe("none");
      expect(payload).not.toHaveProperty("tools");
    }),
  );

const omitsStrictWhenDisabled = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = directCompletionsModel({ supportsStrictMode: false });
      const { payload } = yield* promptModel(model, "Call ping with ok=true", {
        tools: [pingTool],
      });
      const tool = payload.tools?.[0]?.function;
      expect(tool).toBeTruthy();
      expect(tool).not.toHaveProperty("strict");
    }),
  );

const localModel: Model<"openai-completions"> = {
  ...localOpenAICompletionsModel,
  id: "local-model",
  name: "Local Model",
};

const defaultsUnknownEndpointsToLooseTools = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payload } = yield* promptModel(localModel, "Call ping", {
        tools: [optionalFieldTool],
      });
      const functionTool = payload.tools?.[0]?.function;
      expect(functionTool).not.toHaveProperty("strict");
      expect(functionTool?.parameters?.required).toEqual(["required"]);
    }),
  );

describe("openai-completions tool_choice", () => {
  resetMockStateBeforeEach();

  it("forwards toolChoice from simple options to payload", forwardsToolChoice);
  it("includes toolChoice when no tools are provided", sendsToolChoiceWithoutTools);
  it("omits strict when compat disables strict mode", omitsStrictWhenDisabled);
  it(
    "defaults unknown OpenAI-compatible endpoints to non-strict tools",
    defaultsUnknownEndpointsToLooseTools,
  );
});

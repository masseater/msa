import { Clock, Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import compatModule from "../src/compat.ts";
import type compatTypes from "../src/compat.types.ts";
import type typesModule from "../src/types.types.ts";
import liveAuth from "./live-auth.ts";

const { hasLiveAuth } = liveAuth;

const { complete, getModels, getProviders } = compatModule;

const echoToolSchema = Type.Object({
  value: Type.String({ description: "The value to echo" }),
});

const echoTool: typesModule.Tool<typeof echoToolSchema> = {
  description: "Echo a string value",
  name: "echo_value",
  parameters: echoToolSchema,
};

interface AnthropicEagerE2ECase {
  name: string;
  provider: compatTypes.BuiltinProvider;
  model: typesModule.Model<"anthropic-messages">;
  available: boolean;
}

function getAnthropicMessagesModels(
  provider: compatTypes.BuiltinProvider,
): typesModule.Model<"anthropic-messages">[] {
  const models = getModels(provider) as typesModule.Model<typesModule.Api>[];
  return models.filter(
    (model) => model.api === "anthropic-messages",
  ) as typesModule.Model<"anthropic-messages">[];
}

const anthropicMessagesCases: AnthropicEagerE2ECase[] = getProviders().flatMap((provider) =>
  getAnthropicMessagesModels(provider).map((model) => ({
    available: hasLiveAuth(provider),
    model,
    name: `${provider}/${model.id}`,
    provider,
  })),
);

function getProbePriority(model: typesModule.Model<"anthropic-messages">): number {
  const modelId = model.id.toLowerCase();
  const cost = model.cost.input + model.cost.output;
  let priority = cost;

  if (modelId.includes("haiku") && (modelId.includes("4-5") || modelId.includes("4.5"))) {
    priority -= 1000;
  } else if (modelId.includes("sonnet") && (modelId.includes("4-") || modelId.includes("4."))) {
    priority -= 750;
  } else if (modelId.includes("claude") && (modelId.includes("4-") || modelId.includes("4."))) {
    priority -= 500;
  }

  return priority;
}

function selectOneCasePerProvider(cases: AnthropicEagerE2ECase[]): AnthropicEagerE2ECase[] {
  const byProvider = new Map<compatTypes.BuiltinProvider, AnthropicEagerE2ECase[]>();
  for (const testCase of cases) {
    const providerCases = byProvider.get(testCase.provider) ?? [];
    providerCases.push(testCase);
    byProvider.set(testCase.provider, providerCases);
  }

  return Array.from(byProvider.values()).flatMap((providerCases) =>
    providerCases
      .sort(
        (a, b) =>
          getProbePriority(a.model) - getProbePriority(b.model) ||
          a.model.id.localeCompare(b.model.id),
      )
      .slice(0, 1),
  );
}

const generatedCompatCases = selectOneCasePerProvider(anthropicMessagesCases);
const forcedEagerProbeCases = selectOneCasePerProvider(
  anthropicMessagesCases.filter(
    (testCase) => testCase.model.compat?.supportsEagerToolInputStreaming !== false,
  ),
);

function withEagerToolInputStreaming(
  model: typesModule.Model<"anthropic-messages">,
): typesModule.Model<"anthropic-messages"> {
  return {
    ...model,
    compat: {
      ...model.compat,
      supportsEagerToolInputStreaming: true,
    },
  };
}

const expectToolEnabledRequestAccepted = Effect.fn("expectToolEnabledRequestAccepted")(function* (
  model: typesModule.Model<"anthropic-messages">,
) {
  const options: typesModule.ProviderStreamOptions = {
    maxTokens: 128,
    thinkingEnabled: false,
  };
  const currentTime = yield* Clock.currentTimeMillis;
  const response = yield* Effect.promise(() =>
    complete(
      model,
      {
        messages: [
          {
            content: "Call echo_value with value set to eager-input-streaming-compat.",
            role: "user",
            timestamp: currentTime,
          },
        ],
        systemPrompt: "You are a concise assistant. Use tools when useful.",
        tools: [echoTool],
      },
      options,
    ),
  );

  expect(response.errorMessage, response.errorMessage).toBeFalsy();
  expect(response.stopReason, response.errorMessage).not.toBe("error");
});

describe("Anthropic Messages eager tool input streaming E2E", () => {
  it("covers every generated anthropic-messages model", () => {
    const expectedModels = getProviders().flatMap((provider) =>
      getAnthropicMessagesModels(provider).map((model) => `${provider}/${model.id}`),
    );
    expect(anthropicMessagesCases.map((testCase) => testCase.name).sort()).toEqual(
      expectedModels.sort(),
    );
  });

  describe("generated compatibility settings", () => {
    for (const testCase of generatedCompatCases) {
      it.skipIf(!testCase.available)(
        `${testCase.name} accepts configured tool streaming`,
        { retry: 2 },
        () => Effect.runPromise(expectToolEnabledRequestAccepted(testCase.model)),
      );
    }
  });

  describe("forced eager_input_streaming probe", () => {
    for (const testCase of forcedEagerProbeCases) {
      const model = withEagerToolInputStreaming(testCase.model);

      it.skipIf(!testCase.available)(
        `${testCase.name} accepts forced eager_input_streaming`,
        { retry: 2 },
        () => Effect.runPromise(expectToolEnabledRequestAccepted(model)),
      );
    }
  });
});

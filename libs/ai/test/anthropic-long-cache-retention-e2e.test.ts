import { Clock, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import compatModule from "../src/compat.ts";
import type compatTypes from "../src/compat.types.ts";
import envApiKeys from "../src/env-api-keys.ts";
import type typesModule from "../src/types.types.ts";

const { complete, getModels, getProviders } = compatModule;
const { getEnvApiKey } = envApiKeys;

interface AnthropicLongCacheRetentionE2ECase {
  name: string;
  provider: compatTypes.BuiltinProvider;
  model: typesModule.Model<"anthropic-messages">;
  apiKey: string | undefined;
}

function getAnthropicMessagesModels(
  provider: compatTypes.BuiltinProvider,
): typesModule.Model<"anthropic-messages">[] {
  const models = getModels(provider) as typesModule.Model<typesModule.Api>[];
  return models.filter(
    (model) => model.api === "anthropic-messages",
  ) as typesModule.Model<"anthropic-messages">[];
}

const anthropicMessagesCases: AnthropicLongCacheRetentionE2ECase[] = getProviders().flatMap(
  (provider) =>
    getAnthropicMessagesModels(provider).map((model) => ({
      apiKey: getEnvApiKey(provider),
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

function selectOneCasePerProvider(
  cases: AnthropicLongCacheRetentionE2ECase[],
): AnthropicLongCacheRetentionE2ECase[] {
  const byProvider = new Map<compatTypes.BuiltinProvider, AnthropicLongCacheRetentionE2ECase[]>();
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

const probeCases = selectOneCasePerProvider(anthropicMessagesCases);

function withLongCacheRetention(
  model: typesModule.Model<"anthropic-messages">,
): typesModule.Model<"anthropic-messages"> {
  return {
    ...model,
    compat: {
      ...model.compat,
      supportsLongCacheRetention: true,
    },
  };
}

const expectLongCacheRetentionAccepted = Effect.fn("expectLongCacheRetentionAccepted")(function* (
  model: typesModule.Model<"anthropic-messages">,
  apiKey: string | undefined,
) {
  const options: typesModule.ProviderStreamOptions = {
    apiKey,
    cacheRetention: "long",
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
            content: "Reply with exactly: long cache retention accepted",
            role: "user",
            timestamp: currentTime,
          },
        ],
        systemPrompt: "You are a concise assistant.",
      },
      options,
    ),
  );

  expect(response.errorMessage, response.errorMessage).toBeFalsy();
  expect(response.stopReason, response.errorMessage).not.toBe("error");
});

describe("Anthropic Messages long cache retention E2E", () => {
  it("covers every generated anthropic-messages model", () => {
    const expectedModels = getProviders().flatMap((provider) =>
      getAnthropicMessagesModels(provider).map((model) => `${provider}/${model.id}`),
    );
    expect(anthropicMessagesCases.map((testCase) => testCase.name).sort()).toEqual(
      expectedModels.sort(),
    );
  });

  describe("forced long cache retention probe", () => {
    for (const testCase of probeCases) {
      const model = withLongCacheRetention(testCase.model);

      it.skipIf(testCase.apiKey === undefined || testCase.apiKey === "")(
        `${testCase.name} accepts long cache retention`,
        { retry: 2 },
        () => Effect.runPromise(expectLongCacheRetentionAccepted(model, testCase.apiKey)),
      );
    }
  });
});

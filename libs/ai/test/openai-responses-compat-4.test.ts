import { Clock, Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import openaiResponses from "../src/api/openai-responses.ts";
import compatModule from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import jsonCodec from "./json-codec.ts";
import modelChoice from "./model-choice.ts";
import openaiResponsesCompatSupport from "./openai-responses-compat-support.ts";

const { stream: streamOpenAIResponses } = openaiResponses;
const { normalizeContext } = compatModule;

const { encodeJson } = jsonCodec;
const { chooseModel, usesApi } = modelChoice;
const { captureResponsesRequest, respondWith, responsesModel } = openaiResponsesCompatSupport;

const tokenCount = 100_000;
const tokenScale = tokenCount / 1_000_000;

const STANDARD_PRIORITY_MULTIPLIER = 2;

const pricedModel = chooseModel(
  "openai",
  "priced Responses",
  (model): model is typesModule.Model<"openai-responses"> =>
    usesApi("openai-responses")(model) &&
    model.cost.serviceTiers?.priority === STANDARD_PRIORITY_MULTIPLIER &&
    model.cost.input > 0,
);
const surchargedModel = chooseModel(
  "openai",
  "priority-surcharged Responses",
  (model): model is typesModule.Model<"openai-responses"> =>
    usesApi("openai-responses")(model) &&
    (model.cost.serviceTiers?.priority ?? 0) > STANDARD_PRIORITY_MULTIPLIER,
);

const priorityOf = (model: typesModule.Model<"openai-responses">) =>
  model.cost.serviceTiers?.priority ?? 1;
const flexOf = (model: typesModule.Model<"openai-responses">) => model.cost.serviceTiers?.flex ?? 1;

const serviceTierCases = [
  {
    model: pricedModel,
    multiplier: priorityOf(pricedModel),
    requested: "priority",
    returned: "priority",
  },
  {
    model: surchargedModel,
    multiplier: priorityOf(surchargedModel),
    requested: "priority",
    returned: "priority",
  },
  {
    model: surchargedModel,
    multiplier: flexOf(surchargedModel),
    requested: "flex",
    returned: "flex",
  },
  {
    model: pricedModel,
    multiplier: priorityOf(pricedModel),
    requested: "priority",
    returned: "fast",
  },
  { model: pricedModel, multiplier: priorityOf(pricedModel), requested: "fast", returned: "fast" },
] as const;

const appliesServiceTierCost = ({
  model,
  multiplier,
  requested,
  returned,
}: (typeof serviceTierCases)[number]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const completed = yield* encodeJson({
        response: {
          service_tier: returned,
          status: "completed",
          usage: {
            input_tokens: tokenCount,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: tokenCount,
            total_tokens: tokenCount * 2,
          },
        },
        type: "response.completed",
      });
      respondWith(`data: ${completed}\n\n`);
      const timestamp = yield* Clock.currentTimeMillis;
      const result = yield* Effect.promise(() =>
        streamOpenAIResponses(
          model,
          normalizeContext({
            messages: [{ content: "hi", role: "user", timestamp }],
            systemPrompt: "sys",
          }),
          { apiKey: "sk-test-key", serviceTier: requested },
        ).result(),
      );
      const scaled = (perMillion: number) => perMillion * multiplier * tokenScale;
      expect(result.usage.cost.input).toBeCloseTo(scaled(model.cost.input), 12);
      expect(result.usage.cost.output).toBeCloseTo(scaled(model.cost.output), 12);
      expect(result.usage.cost.total).toBeCloseTo(scaled(model.cost.input + model.cost.output), 12);
    }),
  );

const maxOutputTokens = (model: typesModule.Model<"openai-responses">) =>
  captureResponsesRequest({ maxTokens: 1024 }, { model }).pipe(
    Effect.map(({ payload }) => payload?.max_output_tokens),
  );

describe("openai-responses service tier pricing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.for(serviceTierCases)(
    "applies a $multiplier cost multiplier for requested $requested and returned $returned",
    appliesServiceTierCost,
  );
});

describe("openai-responses max_output_tokens compat", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends max_output_tokens by default", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(yield* maxOutputTokens(responsesModel)).toBe(1024);
      }),
    ));
  it("omits max_output_tokens when supportsMaxOutputTokens is false", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = {
          ...responsesModel,
          compat: { ...responsesModel.compat, supportsMaxOutputTokens: false },
        };
        expect(yield* maxOutputTokens(model)).toBeUndefined();
      }),
    ));
});

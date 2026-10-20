import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { streamSimple as streamSimpleOpenAICodexResponses } from "../src/api/openai-codex-responses.ts";
import type { Model } from "../src/types.ts";
import modelChoice from "./model-choice.ts";
import openaiCodexStreamSupport from "./openai-codex-stream-support.ts";

const { chooseModel, modelsWhere } = modelChoice;
const {
  decodeCodexRequestBody,
  helloEvents,
  mockToken,
  promptContext,
  resetCodexStateAfterEach,
  runCodex,
  sseResponse,
  sseText,
  stubCodexFetch,
  usage,
} = openaiCodexStreamSupport;

const codexCatalog = (accepts: (model: Model<"openai-codex-responses">) => boolean) =>
  modelsWhere(
    "openai-codex",
    (model) =>
      model.api === "openai-codex-responses" && accepts(model as Model<"openai-codex-responses">),
  ) as Model<"openai-codex-responses">[];

const keepsXhighFromSimpleOptions = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const [model] = codexCatalog((candidate) => candidate.thinkingLevelMap?.xhigh === "xhigh");
      if (model === undefined) throw new Error("No Codex model supports xhigh reasoning");
      const { requests } = stubCodexFetch();
      yield* Effect.promise(() =>
        streamSimpleOpenAICodexResponses(model, promptContext(), {
          apiKey: mockToken(),
          reasoning: "xhigh",
          transport: "sse",
        }).result(),
      );
      expect(requests[0]?.body?.["reasoning"]).toEqual({ effort: "xhigh", summary: "auto" });
    }),
  );

const clampsMinimalEffort = (model: Model<"openai-codex-responses">) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { requests } = stubCodexFetch();
      yield* runCodex({ reasoningEffort: "minimal" }, { model });
      expect(requests[0]?.body?.["reasoning"]).toEqual({ effort: "low", summary: "auto" });
    }),
  );

const defaultTierSse = sseText(
  helloEvents({
    response: { service_tier: "default", status: "completed", usage: usage(1_000_000, 1_000_000) },
    type: "response.completed",
  }),
);

const pricedModel = chooseModel(
  "openai-codex",
  "standard-priced Codex",
  (model) => model.id !== "gpt-5.5",
);
const surchargedModel = chooseModel(
  "openai-codex",
  "priority-surcharged Codex",
  (model) => model.id === "gpt-5.5",
);

const serviceTierCases = [
  { model: pricedModel, multiplier: 0.5, serviceTier: "flex" },
  { model: pricedModel, multiplier: 2, serviceTier: "priority" },
  { model: surchargedModel, multiplier: 0.5, serviceTier: "flex" },
  { model: surchargedModel, multiplier: 2.5, serviceTier: "priority" },
] as const;

const pricesRequestedTier = ({
  model,
  multiplier,
  serviceTier,
}: (typeof serviceTierCases)[number]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      stubCodexFetch(() => sseResponse(defaultTierSse));
      const result = yield* runCodex(
        { serviceTier },
        { model: { ...model, cost: { cacheRead: 0, cacheWrite: 0, input: 1, output: 2 } } },
      );
      expect(result.usage.cost).toMatchObject({
        input: 1 * multiplier,
        output: 2 * multiplier,
        total: 3 * multiplier,
      });
    }),
  );

const compressesRequestBodies = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { requests } = stubCodexFetch();
      const largeText = "compress me ".repeat(400);
      yield* runCodex({}, { context: promptContext(largeText) });
      yield* runCodex({}, { context: promptContext("hi") });
      expect(requests.map((request) => request.headers?.get("content-encoding"))).toEqual([
        "zstd",
        "zstd",
      ]);
      expect(requests.every((request) => request.rawBody instanceof Uint8Array)).toBe(true);
      const decoded = decodeCodexRequestBody(requests[0]?.rawBody) as {
        input: Array<{ content: Array<{ text: string }> }>;
      };
      expect(decoded.input[0]?.content[0]?.text).toBe(largeText);
    }),
  );

describe("openai-codex reasoning, pricing, and compression", () => {
  resetCodexStateAfterEach();

  it("preserves xhigh reasoning effort from simple options", keepsXhighFromSimpleOptions);
  it.for(codexCatalog((model) => model.thinkingLevelMap?.minimal === "low"))(
    "clamps $id minimal reasoning effort to low",
    clampsMinimalEffort,
  );
  it.for(serviceTierCases)(
    "uses the client-sent $serviceTier service tier when Codex echoes default",
    pricesRequestedTier,
  );
  it("zstd-compresses SSE request bodies", compressesRequestBodies);
});

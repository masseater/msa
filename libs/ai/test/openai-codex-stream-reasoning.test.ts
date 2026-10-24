import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import openaiCodexCompress from "../src/api/openai-codex-compress.ts";
import openaiCodexResponses from "../src/api/openai-codex-responses.ts";
import type typesModule from "../src/types.types.ts";
import modelChoice from "./model-choice.ts";
import openaiCodexStreamSupport from "./openai-codex-stream-support.ts";

const { streamSimple: streamSimpleOpenAICodexResponses } = openaiCodexResponses;

const { modelsWhere } = modelChoice;
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

const codexCatalog = (accepts: (model: typesModule.Model<"openai-codex-responses">) => boolean) =>
  modelsWhere(
    "openai-codex",
    (model) =>
      model.api === "openai-codex-responses" &&
      accepts(model as typesModule.Model<"openai-codex-responses">),
  ) as typesModule.Model<"openai-codex-responses">[];

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

const clampsMinimalEffort = (model: typesModule.Model<"openai-codex-responses">) =>
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

const STANDARD_PRIORITY_MULTIPLIER = 2;

const firstCodex = (
  wanted: string,
  accepts: (model: typesModule.Model<"openai-codex-responses">) => boolean,
) => {
  const [model] = codexCatalog(accepts);
  if (model === undefined) throw new Error(`The openai-codex catalog has no ${wanted} model`);
  return model;
};

const pricedModel = firstCodex(
  "standard-priced Codex",
  (model) => model.cost.serviceTiers?.priority === STANDARD_PRIORITY_MULTIPLIER,
);
const surchargedModel = firstCodex(
  "priority-surcharged Codex",
  (model) => (model.cost.serviceTiers?.priority ?? 0) > STANDARD_PRIORITY_MULTIPLIER,
);

const serviceTierCases = [pricedModel, surchargedModel].flatMap((model) =>
  (["flex", "priority"] as const).map((serviceTier) => ({
    model,
    multiplier: model.cost.serviceTiers?.[serviceTier] ?? 1,
    serviceTier,
  })),
);

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
        {
          model: {
            ...model,
            cost: {
              cacheRead: 0,
              cacheWrite: 0,
              input: 1,
              output: 2,
              ...(model.cost.serviceTiers === undefined
                ? {}
                : { serviceTiers: model.cost.serviceTiers }),
            },
          },
        },
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
      openaiCodexCompress.setRequestBodyCompressor(openaiCodexStreamSupport.zstdCompress);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => openaiCodexCompress.setRequestBodyCompressor(undefined)),
      );
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
    }).pipe(Effect.scoped),
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

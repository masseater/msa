import { describe, expect, it } from "vite-plus/test";

import buildOpenRouterCatalog from "../scripts/openrouter-catalog.ts";
import type openrouterCatalogTypes from "../scripts/openrouter-catalog.types.ts";

function openRouterChatCost(
  pricing: NonNullable<openrouterCatalogTypes.OpenRouterModelListItem["pricing"]>,
) {
  const catalog = buildOpenRouterCatalog(
    [
      {
        id: "anthropic/claude-haiku-5.5",
        name: "Claude Haiku 5.5",
        pricing,
        supported_parameters: ["tools"],
      },
    ],
    [],
    [],
  );
  return catalog.chat[0]?.cost;
}

describe("OpenRouter pricing overrides", () => {
  it("turns prompt-length overrides into tiers", () => {
    expect(
      openRouterChatCost({
        completion: "0.0000005",
        input_cache_read: "0.00000001",
        input_cache_write: "0.000000125",
        overrides: [
          {
            completion: "0.0000025",
            input_cache_read: "0.00000005",
            input_cache_write: "0.000000625",
            min_prompt_tokens: 100000,
            prompt: "0.0000005",
          },
        ],
        prompt: "0.0000001",
      }),
    ).toEqual({
      cacheRead: 0.01,
      cacheWrite: 0.125,
      input: 0.1,
      output: 0.5,
      tiers: [
        { cacheRead: 0.05, cacheWrite: 0.625, input: 0.5, inputTokensAbove: 100000, output: 2.5 },
      ],
    });
  });

  it("keeps base rates missing from an override", () => {
    expect(
      openRouterChatCost({
        completion: "0.000012",
        input_cache_read: "0.0000002",
        input_cache_write: "0.000000375",
        overrides: [{ completion: "0.000018", min_prompt_tokens: 200000, prompt: "0.000004" }],
        prompt: "0.000002",
      })?.tiers,
    ).toEqual([
      { cacheRead: 0.2, cacheWrite: 0.375, input: 4, inputTokensAbove: 200000, output: 18 },
    ]);
  });
});

describe("OpenRouter pricing overrides", () => {
  it("skips time-of-day overrides", () => {
    expect(
      openRouterChatCost({
        completion: "0.000000528",
        overrides: [
          { completion: "0.000000528", prompt: "0.000000132", utc_end: 1600, utc_start: 0 },
          { min_prompt_tokens: 1000, prompt: "0.0000001", utc_days: ["saturday"] },
        ],
        prompt: "0.000000132",
      }),
    ).toEqual({ cacheRead: 0, cacheWrite: 0, input: 0.132, output: 0.528 });
  });
});

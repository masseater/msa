import { describe, expect, it } from "vite-plus/test";

import {
  buildOpenRouterCatalog,
  type OpenRouterModelListItem,
} from "../scripts/openrouter-catalog.ts";

function openRouterChatCost(pricing: NonNullable<OpenRouterModelListItem["pricing"]>) {
  const catalog = buildOpenRouterCatalog(
    [
      {
        id: "anthropic/claude-haiku-5.5",
        name: "Claude Haiku 5.5",
        supported_parameters: ["tools"],
        pricing,
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
        prompt: "0.0000001",
        completion: "0.0000005",
        input_cache_read: "0.00000001",
        input_cache_write: "0.000000125",
        overrides: [
          {
            min_prompt_tokens: 100000,
            prompt: "0.0000005",
            completion: "0.0000025",
            input_cache_read: "0.00000005",
            input_cache_write: "0.000000625",
          },
        ],
      }),
    ).toEqual({
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.125,
      tiers: [
        { inputTokensAbove: 100000, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
      ],
    });
  });

  it("keeps base rates missing from an override", () => {
    expect(
      openRouterChatCost({
        prompt: "0.000002",
        completion: "0.000012",
        input_cache_read: "0.0000002",
        input_cache_write: "0.000000375",
        overrides: [{ min_prompt_tokens: 200000, prompt: "0.000004", completion: "0.000018" }],
      })?.tiers,
    ).toEqual([
      { inputTokensAbove: 200000, input: 4, output: 18, cacheRead: 0.2, cacheWrite: 0.375 },
    ]);
  });

  it("skips time-of-day overrides", () => {
    expect(
      openRouterChatCost({
        prompt: "0.000000132",
        completion: "0.000000528",
        overrides: [
          { utc_start: 0, utc_end: 1600, prompt: "0.000000132", completion: "0.000000528" },
          { utc_days: ["saturday"], min_prompt_tokens: 1000, prompt: "0.0000001" },
        ],
      }),
    ).toEqual({ input: 0.132, output: 0.528, cacheRead: 0, cacheWrite: 0 });
  });
});

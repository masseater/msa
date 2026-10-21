import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";

import compatSchema from "../src/providers/compat-schema.ts";
import openaiCompatSchema from "../src/providers/openai-compat-schema.ts";

const { AnthropicMessagesCompatSchema, ProviderCompatSchema } = compatSchema;
const { OpenAICompletionsCompatSchema, OpenAIResponsesCompatSchema } = openaiCompatSchema;

type ProviderCompat = Static<typeof ProviderCompatSchema>;

describe("compatibility schemas", () => {
  it("preserves property types in the provider superset", () => {
    expectTypeOf<ProviderCompat["supportsStore"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<ProviderCompat["sessionAffinityFormat"]>().toEqualTypeOf<
      "openai" | "openai-nosession" | "openrouter" | undefined
    >();
  });

  it("preserves API-specific defaults", () => {
    const completionsDefaults = Compile(OpenAICompletionsCompatSchema).Default({});
    expect(completionsDefaults).not.toHaveProperty("thinkingFormat");
    expect(completionsDefaults).not.toHaveProperty("supportsLongCacheRetention");
    expect(Compile(OpenAIResponsesCompatSchema).Default({})).toMatchObject({
      supportsDeveloperRole: true,
    });
    const anthropicDefaults = Compile(AnthropicMessagesCompatSchema).Default({});
    expect(anthropicDefaults).not.toHaveProperty("sendSessionAffinityHeaders");
    expect(anthropicDefaults).toMatchObject({ supportsLongCacheRetention: true });
  });

  it("does not assign API-specific defaults to the provider superset", () => {
    const defaults = Compile(ProviderCompatSchema).Default({});
    expect(defaults).not.toHaveProperty("supportsDeveloperRole");
    expect(defaults).not.toHaveProperty("sendSessionAffinityHeaders");
    expect(defaults).not.toHaveProperty("supportsLongCacheRetention");
    expect(defaults).not.toHaveProperty("supportsStrictMode");
  });
});

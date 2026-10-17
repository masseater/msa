import { expectTypeOf, it } from "vite-plus/test";

import { XAI_MODELS } from "../src/providers/xai.models.ts";

it("derives model API, ID, and provider literals from grouped model data", () => {
  expectTypeOf(XAI_MODELS["grok-4.5"].api).toEqualTypeOf<"openai-responses">();
  expectTypeOf(XAI_MODELS["grok-4.5"].id).toEqualTypeOf<"grok-4.5">();
  expectTypeOf(XAI_MODELS["grok-4.5"].provider).toEqualTypeOf<"xai">();
  expectTypeOf(XAI_MODELS["grok-4.6"].api).toEqualTypeOf<"openai-responses">();
  expectTypeOf(XAI_MODELS["grok-4.6"].id).toEqualTypeOf<"grok-4.6">();
  expectTypeOf(XAI_MODELS["grok-4.7"].api).toEqualTypeOf<"openai-responses">();
  expectTypeOf(XAI_MODELS["grok-4.7"].id).toEqualTypeOf<"grok-4.7">();
  expectTypeOf(XAI_MODELS["grok-4.3"].api).toEqualTypeOf<"openai-responses">();
});

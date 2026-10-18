import { expectTypeOf, it } from "vite-plus/test";

import { OPENAI_MODELS } from "../src/providers/openai.models.ts";

it("derives model API, ID, and provider literals from grouped model data", () => {
  expectTypeOf(OPENAI_MODELS["gpt-5.5"].api).toEqualTypeOf<"openai-responses">();
  expectTypeOf(OPENAI_MODELS["gpt-5.5"].id).toEqualTypeOf<"gpt-5.5">();
  expectTypeOf(OPENAI_MODELS["gpt-5.5"].provider).toEqualTypeOf<"openai">();
  expectTypeOf(OPENAI_MODELS["gpt-5.4"].api).toEqualTypeOf<"openai-responses">();
  expectTypeOf(OPENAI_MODELS["gpt-5.4"].id).toEqualTypeOf<"gpt-5.4">();
  expectTypeOf(OPENAI_MODELS["gpt-6-sol"].api).toEqualTypeOf<"openai-responses">();
  expectTypeOf(OPENAI_MODELS["gpt-6-sol"].id).toEqualTypeOf<"gpt-6-sol">();
  expectTypeOf(OPENAI_MODELS["o3"].api).toEqualTypeOf<"openai-responses">();
});

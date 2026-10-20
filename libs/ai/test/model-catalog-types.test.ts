import { expectTypeOf, it } from "vite-plus/test";

import { OPENAI_MODELS } from "../src/providers/openai.models.ts";

type OpenAICatalog = typeof OPENAI_MODELS;
type OpenAIModelId = keyof OpenAICatalog;

it("derives model API, ID, and provider literals from grouped model data", () => {
  expectTypeOf<OpenAICatalog[OpenAIModelId]["provider"]>().toEqualTypeOf<"openai">();
  expectTypeOf<{ [Id in OpenAIModelId]: OpenAICatalog[Id]["id"] }>().toEqualTypeOf<{
    [Id in OpenAIModelId]: Id;
  }>();
  expectTypeOf<OpenAICatalog[OpenAIModelId]["api"]>().toEqualTypeOf<"openai-responses">();
});

import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { getModel } from "../src/compat.ts";
import type { Model } from "../src/types.ts";
import transcriptToolChangesSupport from "./transcript-tool-changes-support.ts";

const { additionContext, capturePayload, context, modelBase } = transcriptToolChangesSupport;

type KimiPayload = {
  tools?: Array<{ function?: { name: string } }>;
  messages: Array<{ role: string; tools?: Array<{ function?: { name: string } }> }>;
};

const keepsOpenRouterKimiK3AdditionsIn = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const payload = yield* capturePayload<KimiPayload>(
        getModel("openrouter", "moonshotai/kimi-k3"),
        additionContext,
      );

      expect(payload.tools?.map((value) => value.function?.name)).toEqual([
        "base_tool",
        "late_tool",
      ]);
      expect(payload.messages.some((message) => message.tools !== undefined)).toBe(false);
    }),
  );

const keepsKimiK2SystemTextInline = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model: Model<"openai-completions"> = {
        ...modelBase,
        api: "openai-completions",
        compat: { supportsDeveloperRole: false, supportsMidConvoSystemMessages: true },
        id: "kimi-k2.7-code",
        name: "Kimi K2.7 Code",
        provider: "custom",
      };
      const payload = yield* capturePayload<{
        tools?: Array<{ function?: { name: string } }>;
        messages: Array<{
          role: string;
          content?: string;
          tools?: Array<{ function?: { name: string } }>;
        }>;
      }>(model, additionContext);

      expect(payload.tools?.map((value) => value.function?.name)).toEqual([
        "base_tool",
        "late_tool",
      ]);
      expect(payload.messages.some((message) => message.tools !== undefined)).toBe(false);
      expect(
        payload.messages
          .filter((message) => message.role === "system")
          .map((message) => message.content),
      ).toEqual(["base prompt", "updated guidance"]);
    }),
  );

const foldsOpenAICompatibleUpdatesIntoThe = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model: Model<"openai-completions"> = {
        ...modelBase,
        api: "openai-completions",
        id: "custom-model",
        name: "Custom model",
        provider: "custom-provider",
        reasoning: false,
      };
      const payload = yield* capturePayload<{
        tools?: Array<{ function?: { name: string } }>;
        messages: Array<{ role: string; content?: string }>;
      }>(model, context);

      expect(payload.tools?.map((value) => value.function?.name)).toEqual(["late_tool"]);
      expect(payload.messages.map((message) => message.role)).toEqual(["system", "user"]);
      expect(payload.messages[0]?.content).toBe(
        "base prompt\n\nupdated guidance\n\n<rules>\nnew rules\n</rules>",
      );
    }),
  );

describe("transcript system messages", () => {
  test.each(["opencode", "opencode-go"] as const)("anchors additions for %s Kimi K3", (provider) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload<KimiPayload>(
          getModel(provider, "kimi-k3"),
          additionContext,
        );

        expect(payload.tools?.map((value) => value.function?.name)).toEqual(["base_tool"]);
        expect(
          payload.messages
            .find((message) => message.tools)
            ?.tools?.map((value) => value.function?.name),
        ).toEqual(["late_tool"]);
      }),
    ),
  );

  test("keeps OpenRouter Kimi K3 additions in top-level tools", keepsOpenRouterKimiK3AdditionsIn);
});

describe("transcript system messages", () => {
  test(
    "keeps Kimi K2 system text inline without dynamic tool messages",
    keepsKimiK2SystemTextInline,
  );
});

describe("transcript system messages", () => {
  test(
    "folds OpenAI-compatible updates into the system prompt without native support",
    foldsOpenAICompatibleUpdatesIntoThe,
  );
});

import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import type { Model } from "../src/types.ts";
import transcriptToolChangesSupport from "./transcript-tool-changes-support.ts";

const { additionContext, capturePayload, context, modelBase } = transcriptToolChangesSupport;

const mapsSystemMessageAdditionsIntoSynthetic = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model: Model<"openai-responses"> = {
        ...modelBase,
        api: "openai-responses",
        compat: { supportsMidConvoSystemMessages: true, supportsToolSearch: true },
        id: "gpt-5.4",
        name: "GPT-5.4",
        provider: "openai",
      };
      const payload = yield* capturePayload<{
        tools?: Array<{ name: string }>;
        input: Array<{ type?: string; tools?: Array<{ name: string }> }>;
      }>(model, additionContext);

      expect(payload.tools?.map((value) => value.name)).toEqual(["base_tool"]);
      expect(payload.input.map((item) => item.type)).toContain("tool_search_call");
      expect(
        payload.input
          .find((item) => item.type === "tool_search_output")
          ?.tools?.map((value) => value.name),
      ).toEqual(["late_tool"]);
    }),
  );

const foldsOpenAIUpdatesIntoTheLeading = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model: Model<"openai-responses"> = {
        ...modelBase,
        api: "openai-responses",
        compat: { supportsAdditionalTools: true },
        id: "gpt-4.1",
        name: "GPT-4.1",
        provider: "openai",
      };
      const payload = yield* capturePayload<{
        tools?: Array<{ name: string }>;
        input: Array<{ type?: string; role?: string; content?: string }>;
      }>(model, context);

      expect(payload.tools?.map((value) => value.name)).toEqual(["late_tool"]);
      expect(payload.input.map((item) => item.type ?? item.role)).toEqual(["developer", "user"]);
      expect(payload.input[0]?.content).toBe(
        "base prompt\n\nupdated guidance\n\n<rules>\nnew rules\n</rules>",
      );
    }),
  );

const fallsBackToTheCompleteCurrent = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model: Model<"openai-responses"> = {
        ...modelBase,
        api: "openai-responses",
        compat: { supportsAdditionalTools: true, supportsMidConvoSystemMessages: true },
        id: "gpt-5.4",
        name: "GPT-5.4",
        provider: "openai",
      };
      const payload = yield* capturePayload<{
        tools?: Array<{ name: string }>;
        input: Array<{ type?: string; role?: string }>;
      }>(model, context);

      expect(payload.tools?.map((value) => value.name)).toEqual(["late_tool"]);
      expect(payload.input.some((item) => item.type === "additional_tools")).toBe(false);
      expect(payload.input.filter((item) => item.role === "developer")).toHaveLength(2);
    }),
  );

const anchorsKimiAdditionsInToolBearing = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model: Model<"openai-completions"> = {
        ...modelBase,
        api: "openai-completions",
        compat: {
          supportsDeveloperRole: false,
          supportsMidConvoSystemMessages: true,
          supportsMidConvoToolAdditions: true,
        },
        id: "kimi-k3",
        name: "Kimi K3",
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

      expect(payload.tools?.map((value) => value.function?.name)).toEqual(["base_tool"]);
      expect(
        payload.messages
          .find((message) => message.tools)
          ?.tools?.map((value) => value.function?.name),
      ).toEqual(["late_tool"]);
      expect(
        payload.messages
          .filter((message) => message.role === "system")
          .map((message) => message.content),
      ).toEqual(["base prompt", undefined, "updated guidance"]);
    }),
  );

describe("transcript system messages", () => {
  test(
    "maps system-message additions into synthetic tool search",
    mapsSystemMessageAdditionsIntoSynthetic,
  );
});

describe("transcript system messages", () => {
  test(
    "folds OpenAI updates into the leading developer message without native support",
    foldsOpenAIUpdatesIntoTheLeading,
  );

  test(
    "falls back to the complete current tool state when removals are unsupported",
    fallsBackToTheCompleteCurrent,
  );
});

describe("transcript system messages", () => {
  test("anchors Kimi additions in tool-bearing system messages", anchorsKimiAdditionsInToolBearing);
});

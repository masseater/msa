import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import type typesModule from "../src/types.types.ts";
import transcriptToolChangesSupport from "./transcript-tool-changes-support.ts";

const { additionContext, anthropicNativeModel, capturePayload, context, lateTool, modelBase } =
  transcriptToolChangesSupport;

interface AnthropicToolDefinition {
  name: string;
  description?: string;
  defer_loading?: boolean;
  cache_control?: unknown;
}

interface AnthropicPayload {
  betas?: string[];
  system?: Array<{ text: string }>;
  tools?: AnthropicToolDefinition[];
  messages: Array<{
    role: string;
    content: Array<{
      type: string;
      text?: string;
      cache_control?: unknown;
      tool?: { type: string; name?: string; definition?: AnthropicToolDefinition };
    }>;
  }>;
}

const sendsTheCurrentAnthropicToolList = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const payload = yield* capturePayload<AnthropicPayload>(anthropicNativeModel, {
        messages: [
          { content: "base prompt", role: "system", timestamp: 0 },
          { content: "before", role: "user", timestamp: 1 },
          { content: "updated guidance", role: "system", timestamp: 2, toolsAdded: [lateTool] },
        ],
      });
      expect(payload.betas ?? []).not.toContain("inline-tools-2026-09-15");
      expect(payload.tools).toMatchObject([
        { cache_control: { type: "ephemeral" }, name: "late_tool" },
      ]);
      expect(payload.tools?.[0]?.defer_loading).toBeUndefined();
      expect(payload.messages.at(-1)?.content.map((block) => block.type)).toEqual(["text"]);
    }),
  );

const foldsAnthropicUpdatesIntoTheSystem = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model: typesModule.Model<"anthropic-messages"> = {
        ...modelBase,
        api: "anthropic-messages",
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        provider: "anthropic-api",
      };
      const payload = yield* capturePayload<{
        betas?: string[];
        system?: Array<{ text: string }>;
        tools?: Array<{ name: string }>;
        messages: Array<{ role: string }>;
      }>(model, context);

      expect(payload.betas ?? []).not.toContain("inline-tools-2026-09-15");
      expect(payload.system?.map((block) => block.text)).toEqual([
        "base prompt\n\nupdated guidance\n\n<rules>\nnew rules\n</rules>",
      ]);
      expect(payload.tools?.map((value) => value.name)).toEqual(["late_tool"]);
      expect(payload.messages.map((message) => message.role)).toEqual(["user"]);
    }),
  );

const requiresBothAnthropicCapabilitiesForNative = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model: typesModule.Model<"anthropic-messages"> = {
        ...modelBase,
        api: "anthropic-messages",
        compat: { supportsMidConvoToolChanges: true },
        id: "claude-opus-5",
        name: "Claude Opus 5",
        provider: "anthropic-api",
      };
      const payload = yield* capturePayload<{
        betas?: string[];
        tools?: Array<{ name: string }>;
        messages: Array<{ role: string }>;
      }>(model, context);

      expect(payload.betas ?? []).not.toContain("inline-tools-2026-09-15");
      expect(payload.tools?.map((value) => value.name)).toEqual(["late_tool"]);
      expect(payload.messages.map((message) => message.role)).toEqual(["user"]);
    }),
  );

const anchorsOpenAIAdditionsAtTheirDeveloper = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model: typesModule.Model<"openai-responses"> = {
        ...modelBase,
        api: "openai-responses",
        compat: { supportsAdditionalTools: true, supportsMidConvoSystemMessages: true },
        id: "gpt-5.4",
        name: "GPT-5.4",
        provider: "openai",
      };
      const payload = yield* capturePayload<{
        tools?: Array<{ name: string }>;
        input: Array<{
          type?: string;
          role?: string;
          content?: string;
          tools?: Array<{ name: string }>;
        }>;
      }>(model, additionContext);

      expect(payload.tools?.map((value) => value.name)).toEqual(["base_tool"]);
      expect(
        payload.input
          .find((item) => item.type === "additional_tools")
          ?.tools?.map((value) => value.name),
      ).toEqual(["late_tool"]);
      expect(
        payload.input
          .filter((item) => item.role === "developer" && item.type === undefined)
          .map((item) => item.content),
      ).toEqual(["base prompt", "updated guidance"]);
    }),
  );

describe("transcript system messages", () => {
  test(
    "sends the current Anthropic tool list without an initial tool",
    sendsTheCurrentAnthropicToolList,
  );

  test(
    "folds Anthropic updates into the system prompt without native support",
    foldsAnthropicUpdatesIntoTheSystem,
  );
});

describe("transcript system messages", () => {
  test(
    "requires both Anthropic capabilities for native tool changes",
    requiresBothAnthropicCapabilitiesForNative,
  );
});

describe("transcript system messages", () => {
  test(
    "anchors OpenAI additions at their developer message",
    anchorsOpenAIAdditionsAtTheirDeveloper,
  );
});

import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import transcriptToolChangesSupport from "./transcript-tool-changes-support.ts";

const { anthropicNativeModel, baseTool, capturePayload, context } = transcriptToolChangesSupport;

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

const sendsAnthropicUpdatesAndToolChanges = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const payload = yield* capturePayload<AnthropicPayload>(anthropicNativeModel, context);

      expect(payload.betas).toContain("inline-tools-2026-09-15");
      expect(payload.betas).not.toContain("mid-conversation-tool-changes-2026-07-01");
      expect(payload.system?.map((block) => block.text)).toEqual([
        "base prompt\n\n<rules>\nold rules\n</rules>\n\n<docs>\nread docs\n</docs>",
      ]);
      expect(payload.tools).toMatchObject([
        { cache_control: { type: "ephemeral" }, name: "base_tool" },
        { defer_loading: true, name: "__pi_deferred_placeholder__" },
      ]);
      expect(payload.tools).toHaveLength(2);
      expect(payload.tools?.[0]?.defer_loading).toBeUndefined();
      expect(payload.tools?.[1]?.cache_control).toBeUndefined();
      const update = payload.messages.at(-1);
      expect(update).toMatchObject({
        content: [
          { type: "text" },
          { tool: { name: "base_tool", type: "tool_reference" }, type: "tool_removal" },
          {
            cache_control: { type: "ephemeral" },
            tool: {
              definition: { description: "late_tool tool", name: "late_tool" },
              type: "tool_definition",
            },
            type: "tool_addition",
          },
        ],
        role: "system",
      });
      const definition = update?.content[2]?.tool?.definition;
      expect(definition?.cache_control).toBeUndefined();
      expect(definition?.defer_loading).toBeUndefined();
      expect(update?.content[0]?.text).toContain("updated guidance");
      expect(update?.content[0]?.text).toContain("<rules>\nnew rules\n</rules>");
      expect(update?.content[0]?.text).toContain('Removed system prompt section "docs"');

      const initial = yield* capturePayload<AnthropicPayload>(anthropicNativeModel, {
        messages: context.messages.slice(0, 2),
      });
      expect(initial.tools?.map((declared) => declared.name)).toEqual([
        "base_tool",
        "__pi_deferred_placeholder__",
      ]);
    }),
  );

const redefinesAnAnthropicToolByValue = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const redefinedTool = { ...baseTool, description: "changed" };
      const payload = yield* capturePayload<AnthropicPayload>(anthropicNativeModel, {
        messages: [
          { content: "base prompt", role: "system", timestamp: 0, toolsAdded: [baseTool] },
          { content: "before", role: "user", timestamp: 1 },
          {
            content: "",
            role: "system",
            timestamp: 2,
            toolsAdded: [redefinedTool],
            toolsRemoved: [{ name: "base_tool" }],
          },
        ],
      });

      expect(payload.betas).toContain("inline-tools-2026-09-15");
      expect(payload.tools).toMatchObject([
        { description: "base_tool tool", name: "base_tool" },
        { name: "__pi_deferred_placeholder__" },
      ]);
      expect(payload.messages.at(-1)).toMatchObject({
        content: [
          {
            tool: {
              definition: { description: "changed", name: "base_tool" },
              type: "tool_definition",
            },
            type: "tool_addition",
          },
        ],
        role: "system",
      });
      expect(payload.messages.at(-1)?.content).toHaveLength(1);
    }),
  );

describe("transcript system messages", () => {
  test(
    "sends Anthropic updates and tool changes in native system messages",
    sendsAnthropicUpdatesAndToolChanges,
  );
});

describe("transcript system messages", () => {
  test("redefines an Anthropic tool by value under the same name", redefinesAnAnthropicToolByValue);
});

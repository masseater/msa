import { Function as Fn } from "effect";

import type { SessionEntry } from "../session-manager.ts";
import type { RenderedToolHtml, ToolHtmlRenderer } from "./export-types.ts";

const TEMPLATE_RENDERED_TOOLS = new Set(["bash", "read", "write", "edit", "ls"]);

type MessageEntry = Extract<SessionEntry, { type: "message" }>;

function renderToolCalls(
  message: MessageEntry["message"],
  toolRenderer: ToolHtmlRenderer,
  renderedTools: Record<string, RenderedToolHtml>,
): void {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return;
  for (const block of message.content) {
    if (block.type !== "toolCall" || TEMPLATE_RENDERED_TOOLS.has(block.name)) continue;
    const callHtml = toolRenderer.renderCall(block.id, block.name, block.arguments);
    if (callHtml !== undefined && callHtml !== "") {
      renderedTools[block.id] = { callHtml };
    }
  }
}

function renderToolResult(
  message: MessageEntry["message"],
  toolRenderer: ToolHtmlRenderer,
  renderedTools: Record<string, RenderedToolHtml>,
): void {
  if (message.role !== "toolResult" || message.toolCallId === "") return;
  const toolName = message.toolName || "";
  const existing = renderedTools[message.toolCallId];
  if (existing === undefined && TEMPLATE_RENDERED_TOOLS.has(toolName)) return;
  const rendered = toolRenderer.renderResult(
    message.toolCallId,
    toolName,
    message.content,
    message.details,
    message.isError || false,
  );
  if (rendered !== undefined) {
    renderedTools[message.toolCallId] = {
      ...existing,
      resultHtmlCollapsed: rendered.collapsed,
      resultHtmlExpanded: rendered.expanded,
    };
  }
}

export const preRenderCustomTools: {
  (toolRenderer: ToolHtmlRenderer): (entries: SessionEntry[]) => Record<string, RenderedToolHtml>;
  (entries: SessionEntry[], toolRenderer: ToolHtmlRenderer): Record<string, RenderedToolHtml>;
} = Fn.dual(
  2,
  (entries: SessionEntry[], toolRenderer: ToolHtmlRenderer): Record<string, RenderedToolHtml> => {
    const renderedTools: Record<string, RenderedToolHtml> = {};
    for (const entry of entries) {
      if (entry.type !== "message") continue;
      renderToolCalls(entry.message, toolRenderer, renderedTools);
      renderToolResult(entry.message, toolRenderer, renderedTools);
    }
    return renderedTools;
  },
);

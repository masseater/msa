import { Function as Fn } from "effect";

import type sessionManagerTypes from "../session-manager.types.ts";
import type exportTypesTypes from "./export-types.ts";

const TEMPLATE_RENDERED_TOOLS = new Set(["bash", "read", "write", "edit", "ls"]);

type MessageEntry = Extract<sessionManagerTypes.SessionEntry, { type: "message" }>;

function renderToolCalls(
  message: MessageEntry["message"],
  toolRenderer: exportTypesTypes.ToolHtmlRenderer,
  renderedTools: Map<string, exportTypesTypes.RenderedToolHtml>,
): void {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return;
  for (const block of message.content) {
    if (block.type !== "toolCall" || TEMPLATE_RENDERED_TOOLS.has(block.name)) continue;
    const callHtml = toolRenderer.renderCall(block.id, block.name, block.arguments);
    if (callHtml !== undefined && callHtml !== "") {
      renderedTools.set(block.id, { callHtml });
    }
  }
}

function renderToolResult(
  message: MessageEntry["message"],
  toolRenderer: exportTypesTypes.ToolHtmlRenderer,
  renderedTools: Map<string, exportTypesTypes.RenderedToolHtml>,
): void {
  if (message.role !== "toolResult" || message.toolCallId === "") return;
  const toolName = message.toolName || "";
  const existing = renderedTools.get(message.toolCallId);
  if (existing === undefined && TEMPLATE_RENDERED_TOOLS.has(toolName)) return;
  const rendered = toolRenderer.renderResult(
    message.toolCallId,
    toolName,
    message.content,
    message.details,
    message.isError || false,
  );
  if (rendered !== undefined) {
    renderedTools.set(message.toolCallId, {
      ...existing,
      resultHtmlCollapsed: rendered.collapsed,
      resultHtmlExpanded: rendered.expanded,
    });
  }
}

const preRenderCustomTools: {
  (
    toolRenderer: exportTypesTypes.ToolHtmlRenderer,
  ): (
    entries: sessionManagerTypes.SessionEntry[],
  ) => Record<string, exportTypesTypes.RenderedToolHtml>;
  (
    entries: sessionManagerTypes.SessionEntry[],
    toolRenderer: exportTypesTypes.ToolHtmlRenderer,
  ): Record<string, exportTypesTypes.RenderedToolHtml>;
} = Fn.dual(
  2,
  (
    entries: sessionManagerTypes.SessionEntry[],
    toolRenderer: exportTypesTypes.ToolHtmlRenderer,
  ): Record<string, exportTypesTypes.RenderedToolHtml> => {
    const renderedTools = new Map<string, exportTypesTypes.RenderedToolHtml>();
    for (const entry of entries) {
      if (entry.type !== "message") continue;
      renderToolCalls(entry.message, toolRenderer, renderedTools);
      renderToolResult(entry.message, toolRenderer, renderedTools);
    }
    return Object.fromEntries(renderedTools);
  },
);

const renderCustomTools = {
  preRenderCustomTools,
};

export default renderCustomTools;

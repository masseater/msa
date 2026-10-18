import type { ToolDefinition } from "../extensions/types.ts";
import type { SessionManager } from "../session-manager.ts";

export interface ToolHtmlRenderer {
  renderCall(toolCallId: string, toolName: string, args: unknown): string | undefined;
  renderResult(
    toolCallId: string,
    toolName: string,
    result: Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
    details: unknown,
    isError: boolean,
  ): { collapsed?: string; expanded?: string } | undefined;
}

export interface RenderedToolHtml {
  callHtml?: string | undefined;
  resultHtmlCollapsed?: string | undefined;
  resultHtmlExpanded?: string | undefined;
}

export interface ExportOptions {
  outputPath?: string | undefined;
  themeName?: string | undefined;
  toolRenderer?: ToolHtmlRenderer;
}

export interface SessionData {
  header: ReturnType<SessionManager["getHeader"]>;
  entries: ReturnType<SessionManager["getEntries"]>;
  leafId: string | null;
  systemPrompt?: string | undefined;
  tools?: Array<Pick<ToolDefinition, "name" | "description" | "parameters">> | undefined;
  renderedTools?: Record<string, RenderedToolHtml> | undefined;
}

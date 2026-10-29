import type extensionsTypesTypes from "../extensions/types.types.ts";
import type sessionManagerTypes from "../session-manager.types.ts";

declare namespace exportTypesTypes {
  interface ToolHtmlRenderer {
    renderCall(toolCallId: string, toolName: string, args: unknown): string | undefined;
    renderResult(
      toolCallId: string,
      toolName: string,
      result: Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
      details: unknown,
      isError: boolean,
    ): { collapsed?: string; expanded?: string } | undefined;
  }

  interface RenderedToolHtml {
    callHtml?: string | undefined;
    resultHtmlCollapsed?: string | undefined;
    resultHtmlExpanded?: string | undefined;
  }

  interface ExportOptions {
    outputPath?: string | undefined;
    themeName?: string | undefined;
    toolRenderer?: ToolHtmlRenderer;
    viewedInSrcdoc?: boolean | undefined;
  }

  interface SessionData {
    header: ReturnType<sessionManagerTypes.SessionManager["getHeader"]>;
    entries: ReturnType<sessionManagerTypes.SessionManager["getEntries"]>;
    leafId: string | null;
    tree: ReturnType<sessionManagerTypes.SessionManager["getTree"]>;
    systemPrompt?: string | undefined;
    tools?:
      | Array<Pick<extensionsTypesTypes.ToolDefinition, "name" | "description" | "parameters">>
      | undefined;
    renderedTools?: Record<string, RenderedToolHtml> | undefined;
  }
}

export type { exportTypesTypes as default };

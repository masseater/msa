import type themeTypes from "../../modes/interactive/theme/theme.types.ts";
import type extensionsTypesTypes from "../extensions/types.types.ts";

declare namespace toolRendererTypes {
  interface ToolHtmlRendererDeps {
    getToolRenderers: (name: string) => extensionsTypesTypes.ToolRenderers | undefined;
    theme: themeTypes.Theme;
    cwd: string;
    width?: number;
  }

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
}

export type { toolRendererTypes as default };

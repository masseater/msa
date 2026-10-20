import type aiTypes from "@msa/ai/index.types";
import type tuiTypes from "@msa/tui/index.types";

import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolRenderContext, ToolRenderers } from "../extensions/types.ts";
import { ansiLinesToHtml } from "./ansi-to-html.ts";

export interface ToolHtmlRendererDeps {
  getToolRenderers: (name: string) => ToolRenderers | undefined;
  theme: Theme;
  cwd: string;
  width?: number;
}

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

const ESC = String.fromCodePoint(27);
const ANSI_ESCAPE_REGEX = new RegExp(`${ESC}\\[[\\d;]*m`, "gu");

function isBlankRenderedLine(line: string): boolean {
  return line.replace(ANSI_ESCAPE_REGEX, "").trim().length === 0;
}

function trimRenderedResultLines(lines: string[]): string[] {
  const start = lines.findIndex((line) => !isBlankRenderedLine(line));
  if (start === -1) return [];
  const end = lines.findLastIndex((line) => !isBlankRenderedLine(line));
  return lines.slice(start, end + 1);
}

interface RenderContextInput {
  toolCallId: string;
  lastComponent: tuiTypes.Component | undefined;
  expanded: boolean;
  isPartial: boolean;
  isError: boolean;
}

type ResultBlocks = Array<{ type: string; text?: string; data?: string; mimeType?: string }>;

class HtmlToolRenderer implements ToolHtmlRenderer {
  private readonly renderedCallComponents = new Map<string, tuiTypes.Component>();
  private readonly renderedResultComponents = new Map<string, tuiTypes.Component>();
  private readonly renderedStates = new Map<string, any>();
  private readonly renderedArgs = new Map<string, unknown>();
  private readonly deps: ToolHtmlRendererDeps;
  private readonly width: number;

  constructor(deps: ToolHtmlRendererDeps) {
    this.deps = deps;
    this.width = deps.width ?? 100;
  }

  renderCall(toolCallId: string, toolName: string, args: unknown): string | undefined {
    try {
      this.renderedArgs.set(toolCallId, args);
      const toolDef = this.deps.getToolRenderers(toolName);
      if (toolDef?.renderCall === undefined) {
        return undefined;
      }
      const component = toolDef.renderCall(
        args,
        this.deps.theme,
        this.createRenderContext({
          expanded: false,
          isError: false,
          isPartial: true,
          lastComponent: this.renderedCallComponents.get(toolCallId),
          toolCallId,
        }),
      );
      this.renderedCallComponents.set(toolCallId, component);
      return ansiLinesToHtml(component.render(this.width));
    } catch {
      return undefined;
    }
  }

  renderResult(
    toolCallId: string,
    toolName: string,
    result: ResultBlocks,
    details: unknown,
    isError: boolean,
  ): { collapsed?: string; expanded?: string } | undefined {
    try {
      const toolDef = this.deps.getToolRenderers(toolName);
      if (toolDef?.renderResult === undefined) {
        return undefined;
      }
      const renderResult = toolDef.renderResult;
      const agentToolResult = {
        content: result as (aiTypes.TextContent | aiTypes.ImageContent)[],
        details,
        isError,
      };
      const renderVariant = (expanded: boolean): string => {
        const component = renderResult(
          agentToolResult,
          { expanded, isPartial: false },
          this.deps.theme,
          this.createRenderContext({
            expanded,
            isError,
            isPartial: false,
            lastComponent: this.renderedResultComponents.get(toolCallId),
            toolCallId,
          }),
        );
        this.renderedResultComponents.set(toolCallId, component);
        return ansiLinesToHtml(trimRenderedResultLines(component.render(this.width)));
      };
      const collapsed = renderVariant(false);
      const expanded = renderVariant(true);
      return {
        ...(collapsed !== "" && collapsed !== expanded ? { collapsed } : {}),
        expanded,
      };
    } catch {
      return undefined;
    }
  }

  private getState(toolCallId: string): any {
    let state = this.renderedStates.get(toolCallId);
    if (state === undefined) {
      state = {};
      this.renderedStates.set(toolCallId, state);
    }
    return state;
  }

  private createRenderContext(input: RenderContextInput): ToolRenderContext {
    return {
      args: this.renderedArgs.get(input.toolCallId),
      argsComplete: true,
      cwd: this.deps.cwd,
      durationMs: undefined,
      executionStarted: true,
      expanded: input.expanded,
      invalidate: () => {},
      isError: input.isError,
      isPartial: input.isPartial,
      lastComponent: input.lastComponent,
      outputPad: 1,
      showImages: false,
      state: this.getState(input.toolCallId),
      toolCallId: input.toolCallId,
    };
  }
}

export function createToolHtmlRenderer(deps: ToolHtmlRendererDeps): ToolHtmlRenderer {
  return new HtmlToolRenderer(deps);
}

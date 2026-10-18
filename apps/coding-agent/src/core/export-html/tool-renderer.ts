import type { ImageContent, TextContent } from "@msa/ai";
import type { Component } from "@msa/tui";

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

const ANSI_ESCAPE_REGEX = /\x1b\[[\d;]*m/g;

function isBlankRenderedLine(line: string): boolean {
  return line.replace(ANSI_ESCAPE_REGEX, "").trim().length === 0;
}

function trimRenderedResultLines(lines: string[]): string[] {
  const start = lines.findIndex((line) => !isBlankRenderedLine(line));
  if (start === -1) return [];
  const end = lines.findLastIndex((line) => !isBlankRenderedLine(line));
  return lines.slice(start, end + 1);
}

export function createToolHtmlRenderer(deps: ToolHtmlRendererDeps): ToolHtmlRenderer {
  const { getToolRenderers, theme, cwd, width = 100 } = deps;

  const renderedCallComponents = new Map<string, Component>();
  const renderedResultComponents = new Map<string, Component>();
  const renderedStates = new Map<string, any>();
  const renderedArgs = new Map<string, unknown>();

  const getState = (toolCallId: string): any => {
    let state = renderedStates.get(toolCallId);
    if (!state) {
      state = {};
      renderedStates.set(toolCallId, state);
    }
    return state;
  };

  const createRenderContext = (
    toolCallId: string,
    lastComponent: Component | undefined,
    expanded: boolean,
    isPartial: boolean,
    isError: boolean,
  ): ToolRenderContext => {
    return {
      args: renderedArgs.get(toolCallId),
      toolCallId,
      invalidate: () => {},
      lastComponent,
      state: getState(toolCallId),
      cwd,
      executionStarted: true,
      argsComplete: true,
      isPartial,
      expanded,
      showImages: false,
      isError,
      durationMs: undefined,
      outputPad: 1,
    };
  };

  return {
    renderCall(toolCallId: string, toolName: string, args: unknown): string | undefined {
      try {
        renderedArgs.set(toolCallId, args);
        const toolDef = getToolRenderers(toolName);
        if (toolDef?.renderCall === undefined) {
          return undefined;
        }

        const component = toolDef.renderCall(
          args,
          theme,
          createRenderContext(
            toolCallId,
            renderedCallComponents.get(toolCallId),
            false,
            true,
            false,
          ),
        );
        renderedCallComponents.set(toolCallId, component);
        const lines = component.render(width);
        return ansiLinesToHtml(lines);
      } catch {
        return undefined;
      }
    },

    renderResult(
      toolCallId: string,
      toolName: string,
      result: Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
      details: unknown,
      isError: boolean,
    ): { collapsed?: string; expanded?: string } | undefined {
      try {
        const toolDef = getToolRenderers(toolName);
        if (toolDef?.renderResult === undefined) {
          return undefined;
        }

        const agentToolResult = {
          content: result as (TextContent | ImageContent)[],
          details,
          isError,
        };

        const collapsedComponent = toolDef.renderResult(
          agentToolResult,
          { expanded: false, isPartial: false },
          theme,
          createRenderContext(
            toolCallId,
            renderedResultComponents.get(toolCallId),
            false,
            false,
            isError,
          ),
        );
        renderedResultComponents.set(toolCallId, collapsedComponent);
        const collapsed = ansiLinesToHtml(
          trimRenderedResultLines(collapsedComponent.render(width)),
        );

        const expandedComponent = toolDef.renderResult(
          agentToolResult,
          { expanded: true, isPartial: false },
          theme,
          createRenderContext(
            toolCallId,
            renderedResultComponents.get(toolCallId),
            true,
            false,
            isError,
          ),
        );
        renderedResultComponents.set(toolCallId, expandedComponent);
        const expanded = ansiLinesToHtml(trimRenderedResultLines(expandedComponent.render(width)));

        return {
          ...(collapsed !== "" && collapsed !== expanded ? { collapsed } : {}),
          expanded,
        };
      } catch {
        return undefined;
      }
    },
  };
}

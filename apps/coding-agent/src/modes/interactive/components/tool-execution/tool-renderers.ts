import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypesTypes from "../../../../core/extensions/types.types.ts";
import renderUtils from "../../../../core/tools/render-utils.ts";
import themeModule from "../../theme/theme.ts";
import type ToolExecutionComponent from "../tool-execution.ts";
import visualTruncate from "../visual-truncate.ts";

const { Text, MouseRegion } = tui;
const { formatToolCallWithArgs } = renderUtils;
const { theme } = themeModule;
const { collapsedOutput } = visualTruncate;

export default class ToolRenderers {
  private readonly tool: ToolExecutionComponent;

  constructor(tool: ToolExecutionComponent) {
    this.tool = tool;
  }

  getCallRenderer(): extensionsTypesTypes.ToolDefinition<any, any>["renderCall"] | undefined {
    return this.tool.toolDefinition?.renderCall;
  }

  getResultRenderer(): extensionsTypesTypes.ToolDefinition<any, any>["renderResult"] | undefined {
    return this.tool.toolDefinition?.renderResult;
  }

  hasRendererDefinition(): boolean {
    return this.tool.toolDefinition !== undefined;
  }

  getRenderShell(): "default" | "self" {
    return this.tool.toolDefinition?.renderShell ?? "default";
  }

  createCallFallback(): tuiTypes.Component {
    return new Text(
      formatToolCallWithArgs(this.tool.toolName, this.tool.args, theme, this.tool.expanded),
      0,
      0,
    );
  }

  createResultFallback(): tuiTypes.Component | undefined {
    const output = this.tool.display.getTextOutput();
    if (output === "") {
      return undefined;
    }

    if (!this.tool.expanded) return collapsedOutput(output, "first");
    const lines = output.split("\n");
    return new Text(lines.map((line) => theme.fg("toolOutput", line)).join("\n"), 0, 0);
  }

  getRenderContext(
    lastComponent: tuiTypes.Component | undefined,
  ): extensionsTypesTypes.ToolRenderContext {
    return {
      args: this.tool.args,
      argsComplete: this.tool.argsComplete,
      cwd: this.tool.cwd,
      durationMs: this.tool.isPartial ? undefined : this.tool.result?.durationMs,
      executionStarted: this.tool.executionStarted,
      expanded: this.tool.expanded,
      invalidate: () => {
        this.tool.invalidate();
        this.tool.ui.requestRender();
      },
      isError: this.tool.result?.isError ?? false,
      isPartial: this.tool.isPartial,
      lastComponent,
      outputPad: this.tool.outputPad,
      showImages: this.tool.showImages,
      state: this.tool.rendererState,
      toolCallId: this.tool.toolCallId,
    };
  }

  createResultRegion(component: tuiTypes.Component): tuiTypes.MouseRegion {
    return new MouseRegion(component, (event) => {
      if (this.tool.result === undefined || event.type !== "click" || event.button !== "left")
        return undefined;
      this.tool.setExpanded(!this.tool.expanded);
      return { handled: true };
    });
  }
}

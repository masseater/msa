import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import themeModule from "../theme/theme.ts";
import type toolExecutionTypes from "./tool-execution.types.ts";
import ToolDisplay from "./tool-execution/tool-display.ts";
import ToolRenderers from "./tool-execution/tool-renderers.ts";

const { Box, Text, Spacer, Container } = tui;
const { theme } = themeModule;

export default class ToolExecutionComponent extends tui.Container {
  readonly renderers: ToolRenderers;
  readonly display: ToolDisplay;

  contentBox!: tuiTypes.Box;

  contentText!: tuiTypes.Text;

  private contentTextRegion!: tuiTypes.MouseRegion;

  selfRenderContainer!: tuiTypes.Container;

  private selfRenderHeight = 0;

  callRendererComponent?: tuiTypes.Component | undefined;

  resultRendererComponent?: tuiTypes.Component | undefined;

  rendererState: any = {};

  imageComponents: tuiTypes.Image[] = [];

  imageSources: Array<{ data: string; mimeType: string; widthCells: number }> = [];

  imageSpacers: tuiTypes.Spacer[] = [];

  toolName!: string;

  toolCallId!: string;

  args!: any;

  expanded = false;

  showImages!: boolean;

  imageWidthCells!: number;

  outputPad!: number;

  isPartial = true;

  toolDefinition?: extensionsTypesTypes.ToolRenderers | undefined;

  ui!: tuiTypes.TUI;

  cwd!: string;

  executionStarted = false;

  argsComplete = false;

  result?: {
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    isError: boolean;
    details?: any;
    durationMs?: number;
  };

  getCallSummary(): toolExecutionTypes.ToolCallSummary {
    return {
      args: this.args,
      details: this.result?.details,
      done: this.result !== undefined && !this.isPartial,
      isError: this.result?.isError ?? false,
      toolName: this.toolName,
    };
  }

  override render(width: number): string[] {
    if (this.renderers.hasRendererDefinition() && this.renderers.getRenderShell() === "self") {
      const contentLines = this.selfRenderContainer.render(width);
      this.selfRenderHeight = contentLines.length;
      if (contentLines.length === 0 && this.imageComponents.length === 0) {
        return [];
      }

      const lines: string[] = [];
      if (contentLines.length > 0) {
        lines.push("");
        lines.push(...contentLines);
      }
      for (let i = 0; i < this.imageComponents.length; i++) {
        const spacer = this.imageSpacers[i];
        if (spacer !== undefined) {
          lines.push(...spacer.render(width));
        }
        const imageComponent = this.imageComponents[i];
        if (imageComponent !== undefined) {
          lines.push(...imageComponent.render(width));
        }
      }
      return lines;
    }

    return super.render(width);
  }

  override handleMouse(
    event: tuiTypes.TuiMouseEvent,
  ): ReturnType<tuiTypes.Container["handleMouse"]> {
    if (!this.renderers.hasRendererDefinition() || this.renderers.getRenderShell() !== "self")
      return super.handleMouse(event);
    if (event.y <= 0 || event.y > this.selfRenderHeight) return undefined;
    return this.selfRenderContainer.handleMouse({
      ...event,
      height: this.selfRenderHeight,
      y: event.y - 1,
    });
  }

  updateArgs(args: any): void {
    this.args = args;
    this.display.updateDisplay();
  }

  markExecutionStarted(): void {
    this.executionStarted = true;
    this.display.updateDisplay();
    this.ui.requestRender();
  }

  setArgsComplete(): void {
    this.argsComplete = true;
    this.display.updateDisplay();
    this.ui.requestRender();
  }

  updateResult(
    result: {
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      details?: any;
      isError: boolean;
      durationMs?: number;
    },
    isPartial = false,
  ): void {
    this.result = result;
    this.isPartial = isPartial;
    this.display.updateDisplay();
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.display.updateDisplay();
  }

  setOutputPad(outputPad: number): void {
    this.outputPad = outputPad;
    this.display.updateDisplay();
  }

  setShowImages(show: boolean): void {
    this.showImages = show;
    this.display.updateDisplay();
  }

  setImageWidthCells(width: number): void {
    this.imageWidthCells = Math.max(1, Math.floor(width));
    this.display.updateDisplay();
  }

  override invalidate(): void {
    super.invalidate();
    this.display.updateDisplay();
  }

  constructor(
    toolName: string,
    toolCallId: string,
    args: any,
    options: toolExecutionTypes.ToolExecutionOptions = {},
    toolDefinition:
      | extensionsTypesTypes.ToolRenderers
      | extensionsTypesTypes.ToolDefinition<any, any, any>
      | undefined,
    ui: tuiTypes.TUI,
    cwd: string,
  ) {
    super();
    this.renderers = new ToolRenderers(this);
    this.display = new ToolDisplay(this);
    this.toolName = toolName;
    this.toolCallId = toolCallId;
    this.args = args;
    this.toolDefinition = toolDefinition;
    this.showImages = options.showImages ?? true;
    this.imageWidthCells = options.imageWidthCells ?? 60;
    this.outputPad = options.outputPad ?? 1;
    this.ui = ui;
    this.cwd = cwd;

    this.addChild(new Spacer(1));

    this.contentBox = new Box(1, 1, (text: string) => theme.bg("toolPendingBg", text));
    this.contentText = new Text("", 1, 1, (text: string) => theme.bg("toolPendingBg", text));
    this.contentTextRegion = this.renderers.createResultRegion(this.contentText);
    this.selfRenderContainer = new Container();

    if (this.renderers.hasRendererDefinition()) {
      this.addChild(
        this.renderers.getRenderShell() === "self" ? this.selfRenderContainer : this.contentBox,
      );
    } else {
      this.addChild(this.contentTextRegion);
    }

    this.display.updateDisplay();
  }
}

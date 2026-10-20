import type {
  ToolDefinition,
  ToolRenderContext,
  ToolRenderers,
} from "../../../core/extensions/types.ts";

export type { ToolRenderers };

import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import {
  formatToolCallWithArgs,
  getTextOutput as getRenderedTextOutput,
} from "../../../core/tools/render-utils.ts";
import { ensurePngTranscoder } from "../../../utils/image-convert.ts";
import { theme } from "../theme/theme.ts";
import { collapsedOutput } from "./visual-truncate.ts";

const { Box, Container, Image, MouseRegion, Spacer, Text, getCapabilities } = tui;

export interface ToolExecutionOptions {
  showImages?: boolean;
  imageWidthCells?: number;
  outputPad?: number;
}

export interface ToolCallSummary {
  toolName: string;
  args: any;
  done: boolean;
  isError: boolean;
  details: any;
}

export class ToolExecutionComponent extends Container {
  private contentBox: tuiTypes.Box;
  private contentText: tuiTypes.Text;
  private contentTextRegion: tuiTypes.MouseRegion;
  private selfRenderContainer: tuiTypes.Container;
  private selfRenderHeight = 0;
  private callRendererComponent?: tuiTypes.Component | undefined;
  private resultRendererComponent?: tuiTypes.Component | undefined;
  private rendererState: any = {};
  private imageComponents: tuiTypes.Image[] = [];
  private imageSources: Array<{ data: string; mimeType: string; widthCells: number }> = [];
  private imageSpacers: tuiTypes.Spacer[] = [];
  private toolName: string;
  private toolCallId: string;
  private args: any;
  private expanded = false;
  private showImages: boolean;
  private imageWidthCells: number;
  private outputPad: number;
  private isPartial = true;
  private toolDefinition?: ToolRenderers | undefined;
  private ui: tuiTypes.TUI;
  private cwd: string;
  private executionStarted = false;
  private argsComplete = false;
  private result?: {
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    isError: boolean;
    details?: any;
    durationMs?: number;
  };

  constructor(
    toolName: string,
    toolCallId: string,
    args: any,
    options: ToolExecutionOptions = {},
    toolDefinition: ToolRenderers | ToolDefinition<any, any, any> | undefined,
    ui: tuiTypes.TUI,
    cwd: string,
  ) {
    super();
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
    this.contentTextRegion = this.createResultRegion(this.contentText);
    this.selfRenderContainer = new Container();

    if (this.hasRendererDefinition()) {
      this.addChild(this.getRenderShell() === "self" ? this.selfRenderContainer : this.contentBox);
    } else {
      this.addChild(this.contentTextRegion);
    }

    this.updateDisplay();
  }

  private getCallRenderer(): ToolDefinition<any, any>["renderCall"] | undefined {
    return this.toolDefinition?.renderCall;
  }

  private getResultRenderer(): ToolDefinition<any, any>["renderResult"] | undefined {
    return this.toolDefinition?.renderResult;
  }

  private hasRendererDefinition(): boolean {
    return this.toolDefinition !== undefined;
  }

  private getRenderShell(): "default" | "self" {
    return this.toolDefinition?.renderShell ?? "default";
  }

  private getRenderContext(lastComponent: tuiTypes.Component | undefined): ToolRenderContext {
    return {
      args: this.args,
      argsComplete: this.argsComplete,
      cwd: this.cwd,
      durationMs: this.isPartial ? undefined : this.result?.durationMs,
      executionStarted: this.executionStarted,
      expanded: this.expanded,
      invalidate: () => {
        this.invalidate();
        this.ui.requestRender();
      },
      isError: this.result?.isError ?? false,
      isPartial: this.isPartial,
      lastComponent,
      outputPad: this.outputPad,
      showImages: this.showImages,
      state: this.rendererState,
      toolCallId: this.toolCallId,
    };
  }

  private createCallFallback(): tuiTypes.Component {
    return new Text(formatToolCallWithArgs(this.toolName, this.args, theme, this.expanded), 0, 0);
  }

  private createResultFallback(): tuiTypes.Component | undefined {
    const output = this.getTextOutput();
    if (output === "") {
      return undefined;
    }

    if (!this.expanded) return collapsedOutput(output, "first");
    const lines = output.split("\n");
    return new Text(lines.map((line) => theme.fg("toolOutput", line)).join("\n"), 0, 0);
  }

  private createResultRegion(component: tuiTypes.Component): tuiTypes.MouseRegion {
    return new MouseRegion(component, (event) => {
      if (this.result === undefined || event.type !== "click" || event.button !== "left")
        return undefined;
      this.setExpanded(!this.expanded);
      return { handled: true };
    });
  }

  getCallSummary(): ToolCallSummary {
    return {
      args: this.args,
      details: this.result?.details,
      done: this.result !== undefined && !this.isPartial,
      isError: this.result?.isError ?? false,
      toolName: this.toolName,
    };
  }

  updateArgs(args: any): void {
    this.args = args;
    this.updateDisplay();
  }

  markExecutionStarted(): void {
    this.executionStarted = true;
    this.updateDisplay();
    this.ui.requestRender();
  }

  setArgsComplete(): void {
    this.argsComplete = true;
    this.updateDisplay();
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
    this.updateDisplay();
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.updateDisplay();
  }

  setOutputPad(outputPad: number): void {
    this.outputPad = outputPad;
    this.updateDisplay();
  }

  setShowImages(show: boolean): void {
    this.showImages = show;
    this.updateDisplay();
  }

  setImageWidthCells(width: number): void {
    this.imageWidthCells = Math.max(1, Math.floor(width));
    this.updateDisplay();
  }

  override invalidate(): void {
    super.invalidate();
    this.updateDisplay();
  }

  override render(width: number): string[] {
    if (this.hasRendererDefinition() && this.getRenderShell() === "self") {
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
    if (!this.hasRendererDefinition() || this.getRenderShell() !== "self")
      return super.handleMouse(event);
    if (event.y <= 0 || event.y > this.selfRenderHeight) return undefined;
    return this.selfRenderContainer.handleMouse({
      ...event,
      height: this.selfRenderHeight,
      y: event.y - 1,
    });
  }

  private updateDisplay(): void {
    const bgFn = this.isPartial
      ? (text: string) => theme.bg("toolPendingBg", text)
      : this.result?.isError === true
        ? (text: string) => theme.bg("toolErrorBg", text)
        : (text: string) => theme.bg("toolSuccessBg", text);

    if (this.hasRendererDefinition()) {
      const renderContainer = ToolExecutionComponent.updateDisplayRenderContainer(this, bgFn);

      ToolExecutionComponent.updateDisplayPart2(this, renderContainer);
    } else {
      this.contentText.setCustomBgFn(bgFn);
      this.contentText.setPaddingX(this.outputPad);
      this.contentText.setText(this.formatToolExecution());
    }

    const { previousSources, previousImages } =
      ToolExecutionComponent.updateDisplayPreviousSources(this);

    if (this.result !== undefined) {
      const imageBlocks = this.result.content.filter((c) => c.type === "image");
      const caps = getCapabilities();
      for (const img of imageBlocks) {
        if (
          caps.images !== null &&
          this.showImages &&
          img.data !== undefined &&
          img.data !== "" &&
          img.mimeType !== undefined &&
          img.mimeType !== ""
        ) {
          const spacer = new Spacer(1);
          this.addChild(spacer);
          this.imageSpacers.push(spacer);
          const source = {
            data: img.data,
            mimeType: img.mimeType,
            widthCells: this.imageWidthCells,
          };
          const index = this.imageComponents.length;
          const previous = previousSources[index];
          const imageComponent =
            (previous?.data === source.data &&
            previous.mimeType === source.mimeType &&
            previous.widthCells === source.widthCells
              ? previousImages[index]
              : undefined) ??
            new Image(
              source.data,
              source.mimeType,
              { fallbackColor: (s: string) => theme.fg("toolOutput", s) },
              { maxWidthCells: source.widthCells },
            );
          if (source.mimeType !== "image/png") {
            ensurePngTranscoder(() => {
              this.invalidate();
              this.ui.requestRender();
            });
          }
          this.imageComponents.push(imageComponent);
          this.imageSources.push(source);
          this.addChild(imageComponent);
        }
      }
    }
  }

  private static updateDisplayRenderContainer(
    self: ToolExecutionComponent,
    bgFn: (text: string) => string,
  ): tuiTypes.Container | tuiTypes.Box {
    const renderContainer =
      self.getRenderShell() === "self" ? self.selfRenderContainer : self.contentBox;
    if (renderContainer instanceof Box) {
      renderContainer.setBgFn(bgFn);
      renderContainer.setPaddingX(self.outputPad);
    }
    renderContainer.clear();

    const callRenderer = self.getCallRenderer();
    if (callRenderer === undefined) {
      renderContainer.addChild(self.createResultRegion(self.createCallFallback()));
    } else {
      try {
        const component = callRenderer(
          self.args,
          theme,
          self.getRenderContext(self.callRendererComponent),
        );
        self.callRendererComponent = component;
        renderContainer.addChild(self.createResultRegion(component));
      } catch {
        self.callRendererComponent = undefined;
        renderContainer.addChild(self.createResultRegion(self.createCallFallback()));
      }
    }
    return renderContainer;
  }

  private static updateDisplayPart2(
    self: ToolExecutionComponent,
    renderContainer: tuiTypes.Container | tuiTypes.Box,
  ): void {
    if (self.result !== undefined) {
      const resultRenderer = self.getResultRenderer();
      if (resultRenderer === undefined) {
        const component = self.createResultFallback();
        if (component !== undefined) {
          renderContainer.addChild(self.createResultRegion(component));
        }
      } else {
        try {
          const component = resultRenderer(
            { content: self.result.content as any, details: self.result.details },
            { expanded: self.expanded, isPartial: self.isPartial },
            theme,
            self.getRenderContext(self.resultRendererComponent),
          );
          self.resultRendererComponent = component;
          renderContainer.addChild(self.createResultRegion(component));
        } catch {
          self.resultRendererComponent = undefined;
          const component = self.createResultFallback();
          if (component !== undefined) {
            renderContainer.addChild(self.createResultRegion(component));
          }
        }
      }
    }
  }

  private static updateDisplayPreviousSources(self: ToolExecutionComponent): {
    previousSources: { data: string; mimeType: string; widthCells: number }[];
    previousImages: tuiTypes.Image[];
  } {
    const previousImages = self.imageComponents;
    const previousSources = self.imageSources;
    for (const img of self.imageComponents) {
      self.removeChild(img);
    }
    self.imageComponents = [];
    self.imageSources = [];
    for (const spacer of self.imageSpacers) {
      self.removeChild(spacer);
    }
    self.imageSpacers = [];
    return { previousImages, previousSources };
  }

  private getTextOutput(): string {
    return getRenderedTextOutput(this.result, this.showImages);
  }

  private formatToolExecution(): string {
    let text = theme.fg("toolTitle", theme.bold(this.toolName));
    const content = JSON.stringify(this.args, null, 2);
    if (content !== "") {
      text += `\n\n${content}`;
    }
    const output = this.getTextOutput();
    if (output !== "") {
      text += `\n${output}`;
    }
    return text;
  }
}

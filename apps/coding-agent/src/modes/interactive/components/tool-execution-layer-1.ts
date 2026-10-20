import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import renderUtils from "../../../core/tools/render-utils.ts";
import themeModule from "../theme/theme.ts";
import ToolExecutionComponentLayer0 from "./tool-execution-layer-0.ts";
import type ToolExecutionComponent from "./tool-execution.ts";
import type toolExecutionTypes from "./tool-execution.types.ts";
import visualTruncate from "./visual-truncate.ts";

const { Box, Text } = tui;
const { formatToolCallWithArgs, getTextOutput: getRenderedTextOutput } = renderUtils;
const { theme } = themeModule;
const { collapsedOutput } = visualTruncate;

export default abstract class ToolExecutionComponentLayer1 extends ToolExecutionComponentLayer0 {
  getCallRenderer(): extensionsTypesTypes.ToolDefinition<any, any>["renderCall"] | undefined {
    return this.toolDefinition?.renderCall;
  }

  getResultRenderer(): extensionsTypesTypes.ToolDefinition<any, any>["renderResult"] | undefined {
    return this.toolDefinition?.renderResult;
  }

  protected hasRendererDefinition(): boolean {
    return this.toolDefinition !== undefined;
  }

  getRenderShell(): "default" | "self" {
    return this.toolDefinition?.renderShell ?? "default";
  }

  createCallFallback(): tuiTypes.Component {
    return new Text(formatToolCallWithArgs(this.toolName, this.args, theme, this.expanded), 0, 0);
  }

  createResultFallback(): tuiTypes.Component | undefined {
    const output = this.getTextOutput();
    if (output === "") {
      return undefined;
    }

    if (!this.expanded) return collapsedOutput(output, "first");
    const lines = output.split("\n");
    return new Text(lines.map((line) => theme.fg("toolOutput", line)).join("\n"), 0, 0);
  }

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

  static updateDisplayRenderContainer(
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

  static updateDisplayPart2(
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

  static updateDisplayPreviousSources(self: ToolExecutionComponent): {
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

  protected getTextOutput(): string {
    return getRenderedTextOutput(this.result, this.showImages);
  }

  protected formatToolExecution(): string {
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

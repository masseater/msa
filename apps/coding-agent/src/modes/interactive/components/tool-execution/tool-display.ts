import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import renderUtils from "../../../../core/tools/render-utils.ts";
import imageConvert from "../../../../utils/image-convert.ts";
import themeModule from "../../theme/theme.ts";
import type ToolExecutionComponent from "../tool-execution.ts";

const { Box, Image, Spacer, getCapabilities } = tui;
const { getTextOutput: getRenderedTextOutput } = renderUtils;
const { theme } = themeModule;
const { ensurePngTranscoder } = imageConvert;

export default class ToolDisplay {
  private readonly tool: ToolExecutionComponent;

  constructor(tool: ToolExecutionComponent) {
    this.tool = tool;
  }

  renderCall(bgFn: (text: string) => string): tuiTypes.Container | tuiTypes.Box {
    const renderContainer =
      this.tool.renderers.getRenderShell() === "self"
        ? this.tool.selfRenderContainer
        : this.tool.contentBox;
    if (renderContainer instanceof Box) {
      renderContainer.setBgFn(bgFn);
      renderContainer.setPaddingX(this.tool.outputPad);
    }
    renderContainer.clear();

    const callRenderer = this.tool.renderers.getCallRenderer();
    if (callRenderer === undefined) {
      renderContainer.addChild(
        this.tool.renderers.createResultRegion(this.tool.renderers.createCallFallback()),
      );
    } else {
      try {
        const component = callRenderer(
          this.tool.args,
          theme,
          this.tool.renderers.getRenderContext(this.tool.callRendererComponent),
        );
        this.tool.callRendererComponent = component;
        renderContainer.addChild(this.tool.renderers.createResultRegion(component));
      } catch {
        this.tool.callRendererComponent = undefined;
        renderContainer.addChild(
          this.tool.renderers.createResultRegion(this.tool.renderers.createCallFallback()),
        );
      }
    }
    return renderContainer;
  }

  renderResult(renderContainer: tuiTypes.Container | tuiTypes.Box): void {
    if (this.tool.result !== undefined) {
      const resultRenderer = this.tool.renderers.getResultRenderer();
      if (resultRenderer === undefined) {
        const component = this.tool.renderers.createResultFallback();
        if (component !== undefined) {
          renderContainer.addChild(this.tool.renderers.createResultRegion(component));
        }
      } else {
        try {
          const component = resultRenderer(
            { content: this.tool.result.content as any, details: this.tool.result.details },
            { expanded: this.tool.expanded, isPartial: this.tool.isPartial },
            theme,
            this.tool.renderers.getRenderContext(this.tool.resultRendererComponent),
          );
          this.tool.resultRendererComponent = component;
          renderContainer.addChild(this.tool.renderers.createResultRegion(component));
        } catch {
          this.tool.resultRendererComponent = undefined;
          const component = this.tool.renderers.createResultFallback();
          if (component !== undefined) {
            renderContainer.addChild(this.tool.renderers.createResultRegion(component));
          }
        }
      }
    }
  }

  detachImages(): {
    previousSources: { data: string; mimeType: string; widthCells: number }[];
    previousImages: tuiTypes.Image[];
  } {
    const previousImages = this.tool.imageComponents;
    const previousSources = this.tool.imageSources;
    for (const img of this.tool.imageComponents) {
      this.tool.removeChild(img);
    }
    this.tool.imageComponents = [];
    this.tool.imageSources = [];
    for (const spacer of this.tool.imageSpacers) {
      this.tool.removeChild(spacer);
    }
    this.tool.imageSpacers = [];
    return { previousImages, previousSources };
  }

  getTextOutput(): string {
    return getRenderedTextOutput(this.tool.result, this.tool.showImages);
  }

  private formatToolExecution(): string {
    let text = theme.fg("toolTitle", theme.bold(this.tool.toolName));
    const content = JSON.stringify(this.tool.args, null, 2);
    if (content !== "") {
      text += `\n\n${content}`;
    }
    const output = this.getTextOutput();
    if (output !== "") {
      text += `\n${output}`;
    }
    return text;
  }

  updateDisplay(): void {
    const bgFn = this.tool.isPartial
      ? (text: string) => theme.bg("toolPendingBg", text)
      : this.tool.result?.isError === true
        ? (text: string) => theme.bg("toolErrorBg", text)
        : (text: string) => theme.bg("toolSuccessBg", text);

    if (this.tool.renderers.hasRendererDefinition()) {
      const renderContainer = this.renderCall(bgFn);

      this.renderResult(renderContainer);
    } else {
      this.tool.contentText.setCustomBgFn(bgFn);
      this.tool.contentText.setPaddingX(this.tool.outputPad);
      this.tool.contentText.setText(this.formatToolExecution());
    }

    const { previousSources, previousImages } = this.detachImages();

    if (this.tool.result !== undefined) {
      const imageBlocks = this.tool.result.content.filter((c) => c.type === "image");
      const caps = getCapabilities();
      for (const img of imageBlocks) {
        if (
          caps.images !== null &&
          this.tool.showImages &&
          img.data !== undefined &&
          img.data !== "" &&
          img.mimeType !== undefined &&
          img.mimeType !== ""
        ) {
          const spacer = new Spacer(1);
          this.tool.addChild(spacer);
          this.tool.imageSpacers.push(spacer);
          const source = {
            data: img.data,
            mimeType: img.mimeType,
            widthCells: this.tool.imageWidthCells,
          };
          const imageComponent = this.attachImages(previousSources, source, previousImages);
          this.tool.imageSources.push(source);
          this.tool.addChild(imageComponent);
        }
      }
    }
  }

  private attachImages(
    previousSources: { data: string; mimeType: string; widthCells: number }[],
    source: { data: string; mimeType: string; widthCells: number },
    previousImages: tuiTypes.Image[],
  ) {
    const index = this.tool.imageComponents.length;
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
        this.tool.invalidate();
        this.tool.ui.requestRender();
      });
    }
    this.tool.imageComponents.push(imageComponent);
    return imageComponent;
  }
}

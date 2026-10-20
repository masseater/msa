import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import imageConvert from "../../../utils/image-convert.ts";
import themeModule from "../theme/theme.ts";
import ToolExecutionComponentLayer1 from "./tool-execution-layer-1.ts";
import ToolExecutionComponent from "./tool-execution.ts";

const { Image, MouseRegion, Spacer, getCapabilities } = tui;
const { theme } = themeModule;
const { ensurePngTranscoder } = imageConvert;

export default abstract class ToolExecutionComponentLayer2 extends ToolExecutionComponentLayer1 {
  getRenderContext(
    lastComponent: tuiTypes.Component | undefined,
  ): extensionsTypesTypes.ToolRenderContext {
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

  createResultRegion(component: tuiTypes.Component): tuiTypes.MouseRegion {
    return new MouseRegion(component, (event) => {
      if (this.result === undefined || event.type !== "click" || event.button !== "left")
        return undefined;
      this.setExpanded(!this.expanded);
      return { handled: true };
    });
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

  protected updateDisplay(): void {
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
          const imageComponent = this.updateDisplayPart1(previousSources, source, previousImages);
          this.imageSources.push(source);
          this.addChild(imageComponent);
        }
      }
    }
  }

  protected updateDisplayPart1(
    previousSources: { data: string; mimeType: string; widthCells: number }[],
    source: { data: string; mimeType: string; widthCells: number },
    previousImages: tuiTypes.Image[],
  ) {
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
    return imageComponent;
  }
}

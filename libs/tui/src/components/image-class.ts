import type terminalCapabilitiesTypes from "../terminal-capabilities.types.ts";
import terminalImageSize from "../terminal-image-size.ts";
import type terminalImageSizeTypes from "../terminal-image-size.types.ts";
import terminalImage from "../terminal-image.ts";
import type terminalImageTypes from "../terminal-image.types.ts";
import textTruncate from "../text-truncate.ts";
import type tuiComponentTypes from "../tui-component.types.ts";
import imageClassKit from "./image-class-kit.ts";
import imageTranscoderModule from "./image-transcoder.ts";
import type imageTypes from "./image.types.ts";

const { terminalCapabilities, terminalImageKitty } = imageClassKit;

const { getImageDimensions, getPngDimensions } = terminalImageSize;
const { imageFallback, renderImage } = terminalImage;
const { truncateToWidth } = textTruncate;
const { getCapabilities, getCellDimensions } = terminalCapabilities;
const { allocateImageId } = terminalImageKitty;

function toPng(base64Data: string, mimeType: string): string | null {
  const transcoder = imageTranscoderModule.currentImageTranscoder();
  if (transcoder === undefined) return null;
  const cached = imageTranscoderModule.pngCache.get(base64Data);
  const png = cached === undefined ? transcoder(base64Data, mimeType) : cached;
  imageTranscoderModule.pngCache.delete(base64Data);
  imageTranscoderModule.pngCache.set(base64Data, png);
  if (imageTranscoderModule.pngCache.size > 32)
    imageTranscoderModule.pngCache.delete(imageTranscoderModule.pngCache.keys().next().value!);
  return png;
}

export default class Image implements tuiComponentTypes.Component {
  private base64Data: string;
  private mimeType: string;
  private dimensions: terminalImageSizeTypes.ImageDimensions;
  private theme: imageTypes.ImageTheme;
  private options: imageTypes.ImageOptions;
  private imageId?: number | undefined;
  private pngData?: string | undefined;

  private cachedLines?: string[] | undefined;
  private cachedWidth?: number | undefined;

  constructor(
    base64Data: string,
    mimeType: string,
    theme: imageTypes.ImageTheme,
    options: imageTypes.ImageOptions = {},
    dimensions?: terminalImageSizeTypes.ImageDimensions,
  ) {
    this.base64Data = base64Data;
    this.mimeType = mimeType;
    this.theme = theme;
    this.options = options;
    this.dimensions = dimensions ||
      getImageDimensions(base64Data, mimeType) || { heightPx: 600, widthPx: 800 };
    this.imageId = options.imageId;
  }

  getImageId(): number | undefined {
    return this.imageId;
  }

  invalidate(): void {
    this.cachedLines = undefined;
    this.cachedWidth = undefined;
  }

  private renderFallbackLines(width: number): string[] {
    const fallback = imageFallback(this.mimeType, this.dimensions, this.options.filename);
    return [truncateToWidth(this.theme.fallbackColor(fallback), width)];
  }

  private renderSequenceLines(
    result: terminalImageTypes.RenderedImage,
    protocol: terminalCapabilitiesTypes.ImageProtocol,
  ): string[] {
    if (result.imageId !== undefined && result.imageId !== 0) {
      this.imageId = result.imageId;
    }

    const blankLines: string[] = [];
    for (let i = 0; i < result.rows - 1; i++) {
      blankLines.push("");
    }

    if (protocol === "kitty") {
      return [result.sequence, ...blankLines];
    }

    const rowOffset = result.rows - 1;
    const moveUp = rowOffset > 0 ? `\x1b[${rowOffset}A` : "";
    return [...blankLines, moveUp + result.sequence];
  }

  private renderImageLines(width: number): string[] {
    const maxWidth = Math.max(1, Math.min(width - 2, this.options.maxWidthCells ?? 60));
    const cellDimensions = getCellDimensions();
    const defaultMaxHeight = Math.max(
      1,
      Math.ceil((maxWidth * cellDimensions.widthPx) / cellDimensions.heightPx),
    );
    const maxHeight = this.options.maxHeightCells ?? defaultMaxHeight;

    const caps = getCapabilities();
    let data: string | null = this.base64Data;
    let dimensions = this.dimensions;
    if (caps.images === "kitty" && this.mimeType !== "image/png") {
      this.pngData ??= toPng(this.base64Data, this.mimeType) ?? undefined;
      data = this.pngData ?? null;
      if (data !== null && data !== "") dimensions = getPngDimensions(data) ?? dimensions;
    }

    if (caps.images === null || data === null || data === "") {
      return this.renderFallbackLines(width);
    }

    if (caps.images === "kitty" && this.imageId === undefined) {
      this.imageId = allocateImageId();
    }
    const result = renderImage(data, dimensions, {
      imageId: this.imageId,
      maxHeightCells: maxHeight,
      maxWidthCells: maxWidth,
      moveCursor: false,
    });

    return result === null
      ? this.renderFallbackLines(width)
      : this.renderSequenceLines(result, caps.images);
  }

  render(width: number): string[] {
    if (this.cachedLines !== undefined && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines = this.renderImageLines(width);

    this.cachedLines = lines;
    this.cachedWidth = width;

    return lines;
  }
}

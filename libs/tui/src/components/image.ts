import {
  getCapabilities,
  getCellDimensions,
  type ImageProtocol,
} from "../terminal-capabilities.ts";
import { allocateImageId } from "../terminal-image-kitty.ts";
import {
  getImageDimensions,
  getPngDimensions,
  type ImageDimensions,
} from "../terminal-image-size.ts";
import { imageFallback, renderImage, type RenderedImage } from "../terminal-image.ts";
import { truncateToWidth } from "../text-truncate.ts";
import type { Component } from "../tui-component.ts";

export type ImageTranscoder = (base64Data: string, mimeType: string) => string | null;

let imageTranscoder: ImageTranscoder | undefined;
const pngCache = new Map<string, string | null>();

export function setImageTranscoder(transcoder: ImageTranscoder | undefined): void {
  imageTranscoder = transcoder;
  pngCache.clear();
}

function toPng(base64Data: string, mimeType: string): string | null {
  if (imageTranscoder === undefined) return null;
  const cached = pngCache.get(base64Data);
  const png = cached === undefined ? imageTranscoder(base64Data, mimeType) : cached;
  pngCache.delete(base64Data);
  pngCache.set(base64Data, png);
  if (pngCache.size > 32) pngCache.delete(pngCache.keys().next().value!);
  return png;
}

export interface ImageTheme {
  fallbackColor: (str: string) => string;
}

export interface ImageOptions {
  maxWidthCells?: number;
  maxHeightCells?: number;
  filename?: string;
  imageId?: number;
}

export class Image implements Component {
  private base64Data: string;
  private mimeType: string;
  private dimensions: ImageDimensions;
  private theme: ImageTheme;
  private options: ImageOptions;
  private imageId?: number | undefined;
  private pngData?: string | undefined;

  private cachedLines?: string[] | undefined;
  private cachedWidth?: number | undefined;

  constructor(
    base64Data: string,
    mimeType: string,
    theme: ImageTheme,
    options: ImageOptions = {},
    dimensions?: ImageDimensions,
  ) {
    this.base64Data = base64Data;
    this.mimeType = mimeType;
    this.theme = theme;
    this.options = options;
    this.dimensions = dimensions ||
      getImageDimensions(base64Data, mimeType) || { widthPx: 800, heightPx: 600 };
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

  private renderSequenceLines(result: RenderedImage, protocol: ImageProtocol): string[] {
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
      maxWidthCells: maxWidth,
      maxHeightCells: maxHeight,
      imageId: this.imageId,
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

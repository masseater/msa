import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

import { dual } from "effect/Function";

import { pathOperations } from "./platform.ts";
import { getCapabilities, getCellDimensions } from "./terminal-capabilities.ts";
import { encodeKitty, registerKittyImageMetadata } from "./terminal-image-kitty.ts";
import { calculateImageCellSize, type ImageDimensions } from "./terminal-image-size.ts";

export interface ImageRenderOptions {
  maxWidthCells?: number;
  maxHeightCells?: number;
  preserveAspectRatio?: boolean;
  imageId?: number | undefined;
  moveCursor?: boolean | undefined;
}

export const encodeITerm2: {
  (
    base64Data: string,
    options?: {
      width?: number | string;
      height?: number | string;
      name?: string;
      preserveAspectRatio?: boolean;
      inline?: boolean;
    },
  ): string;
  (options?: {
    width?: number | string;
    height?: number | string;
    name?: string;
    preserveAspectRatio?: boolean;
    inline?: boolean;
  }): (base64Data: string) => string;
} = dual(
  (args) => typeof args[0] === "string",
  (
    base64Data: string,
    options: {
      width?: number | string;
      height?: number | string;
      name?: string;
      preserveAspectRatio?: boolean;
      inline?: boolean;
    } = {},
  ): string => {
    const params: string[] = [
      `inline=${options.inline === false ? 0 : 1}`,
      `size=${Buffer.byteLength(base64Data, "base64")}`,
    ];

    if (options.width !== undefined) params.push(`width=${options.width}`);
    if (options.height !== undefined) params.push(`height=${options.height}`);
    if (options.name !== undefined && options.name !== "") {
      const nameBase64 = Buffer.from(options.name).toString("base64");
      params.push(`name=${nameBase64}`);
    }
    if (options.preserveAspectRatio === false) {
      params.push("preserveAspectRatio=0");
    }

    return `\x1b]1337;File=${params.join(";")}:${base64Data}\x07`;
  },
);

export interface RenderedImage {
  sequence: string;
  columns: number;
  rows: number;
  imageId?: number | undefined;
}

export const renderImage: {
  (
    base64Data: string,
    imageDimensions: ImageDimensions,
    options?: ImageRenderOptions,
  ): RenderedImage | null;
  (
    imageDimensions: ImageDimensions,
    options?: ImageRenderOptions,
  ): (base64Data: string) => RenderedImage | null;
} = dual(
  (args) => typeof args[0] === "string",
  (
    base64Data: string,
    imageDimensions: ImageDimensions,
    options: ImageRenderOptions = {},
  ): RenderedImage | null => {
    const caps = getCapabilities();

    if (caps.images === null) {
      return null;
    }

    const maxWidth = options.maxWidthCells ?? 80;
    const size = calculateImageCellSize(
      imageDimensions,
      maxWidth,
      options.maxHeightCells,
      getCellDimensions(),
      caps.images === "kitty",
    );

    if (caps.images === "kitty") {
      if (options.imageId !== undefined) {
        registerKittyImageMetadata({
          imageId: options.imageId,
          columns: size.columns,
          rows: size.rows,
          widthPx: imageDimensions.widthPx,
          heightPx: imageDimensions.heightPx,
        });
      }
      const sequence = encodeKitty(base64Data, {
        columns: size.columns,
        rows: size.rows,
        imageId: options.imageId,
        moveCursor: options.moveCursor,
      });
      return { sequence, columns: size.columns, rows: size.rows, imageId: options.imageId };
    }

    if (caps.images === "iterm2") {
      const sequence = encodeITerm2(base64Data, {
        width: size.columns,
        height: "auto",
        preserveAspectRatio: options.preserveAspectRatio ?? true,
      });
      return { sequence, columns: size.columns, rows: size.rows };
    }

    return null;
  },
);

export const hyperlink: {
  (text: string, url: string): string;
  (url: string): (text: string) => string;
} = dual(2, (text: string, url: string): string => `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`);

function shortenImagePath(filename: string): string {
  const home = homedir();
  if (
    home !== "" &&
    (filename === home || filename.startsWith(`${home}/`) || filename.startsWith(`${home}\\`))
  ) {
    return `~${filename.slice(home.length)}`;
  }
  return filename;
}

export const imageFallback: {
  (mimeType: string, dimensions?: ImageDimensions, filename?: string): string;
  (dimensions?: ImageDimensions, filename?: string): (mimeType: string) => string;
} = dual(
  (args) => typeof args[0] === "string",
  (mimeType: string, dimensions?: ImageDimensions, filename?: string): string => {
    const parts: string[] = [];
    if (filename !== undefined && filename !== "") {
      const display = shortenImagePath(filename);
      if (getCapabilities().hyperlinks && pathOperations.isAbsolute(filename)) {
        parts.push(hyperlink(display, pathToFileURL(filename).href));
      } else {
        parts.push(display);
      }
    }
    parts.push(`[${mimeType}]`);
    if (dimensions !== undefined) parts.push(`${dimensions.widthPx}x${dimensions.heightPx}`);
    return `[Image: ${parts.join(" ")}]`;
  },
);

import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

import { dual } from "effect/Function";

import platform from "./platform.ts";
import terminalCapabilities from "./terminal-capabilities.ts";
import terminalImageKitty from "./terminal-image-kitty.ts";
import terminalImageSize from "./terminal-image-size.ts";
import type terminalImageSizeTypes from "./terminal-image-size.types.ts";
import type terminalImageTypes from "./terminal-image.types.ts";

const { getCapabilities, getCellDimensions } = terminalCapabilities;
const { calculateImageCellSize } = terminalImageSize;
const { encodeKitty, registerKittyImageMetadata } = terminalImageKitty;
const { pathOperations } = platform;

const encodeITerm2: {
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

const renderImage: {
  (
    base64Data: string,
    imageDimensions: terminalImageSizeTypes.ImageDimensions,
    options?: terminalImageTypes.ImageRenderOptions,
  ): terminalImageTypes.RenderedImage | null;
  (
    imageDimensions: terminalImageSizeTypes.ImageDimensions,
    options?: terminalImageTypes.ImageRenderOptions,
  ): (base64Data: string) => terminalImageTypes.RenderedImage | null;
} = dual(
  (args) => typeof args[0] === "string",
  (
    base64Data: string,
    imageDimensions: terminalImageSizeTypes.ImageDimensions,
    options: terminalImageTypes.ImageRenderOptions = {},
  ): terminalImageTypes.RenderedImage | null => {
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
          columns: size.columns,
          heightPx: imageDimensions.heightPx,
          imageId: options.imageId,
          rows: size.rows,
          widthPx: imageDimensions.widthPx,
        });
      }
      const sequence = encodeKitty(base64Data, {
        columns: size.columns,
        imageId: options.imageId,
        moveCursor: options.moveCursor,
        rows: size.rows,
      });
      return { columns: size.columns, imageId: options.imageId, rows: size.rows, sequence };
    }

    if (caps.images === "iterm2") {
      const sequence = encodeITerm2(base64Data, {
        height: "auto",
        preserveAspectRatio: options.preserveAspectRatio ?? true,
        width: size.columns,
      });
      return { columns: size.columns, rows: size.rows, sequence };
    }

    return null;
  },
);

const hyperlink: {
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

const imageFallback: {
  (
    mimeType: string,
    dimensions?: terminalImageSizeTypes.ImageDimensions,
    filename?: string,
  ): string;
  (
    dimensions?: terminalImageSizeTypes.ImageDimensions,
    filename?: string,
  ): (mimeType: string) => string;
} = dual(
  (args) => typeof args[0] === "string",
  (
    mimeType: string,
    dimensions?: terminalImageSizeTypes.ImageDimensions,
    filename?: string,
  ): string => {
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

const terminalImage = {
  encodeITerm2,
  hyperlink,
  imageFallback,
  renderImage,
};

export default terminalImage;

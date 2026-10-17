import { dual } from "effect/Function";

import { type CellDimensions, getCellDimensions } from "./terminal-capabilities.ts";
import type { ImageCellSize } from "./terminal-image-kitty.ts";

export interface ImageDimensions {
  widthPx: number;
  heightPx: number;
}

function chooseLessDistortedCellCount(upperCount: number, idealCount: number): number {
  if (upperCount <= 1) return upperCount;

  const lowerCount = upperCount - 1;
  const upperDistortion = Math.max(upperCount / idealCount, idealCount / upperCount);
  const lowerDistortion = Math.max(lowerCount / idealCount, idealCount / lowerCount);
  return lowerDistortion < upperDistortion ? lowerCount : upperCount;
}

export const calculateImageCellSize: {
  (
    imageDimensions: ImageDimensions,
    maxWidthCells: number,
    maxHeightCells?: number,
    cellSize?: CellDimensions,
    optimizeAspectRatio?: boolean,
  ): ImageCellSize;
  (
    maxWidthCells: number,
    maxHeightCells?: number,
    cellSize?: CellDimensions,
    optimizeAspectRatio?: boolean,
  ): (imageDimensions: ImageDimensions) => ImageCellSize;
} = dual(
  (args) => typeof args[0] === "object" && args[0] !== null && !Array.isArray(args[0]),
  (
    imageDimensions: ImageDimensions,
    maxWidthCells: number,
    maxHeightCells?: number,
    cellSize: CellDimensions = { widthPx: 9, heightPx: 18 },
    optimizeAspectRatio: boolean = false,
  ): ImageCellSize => {
    const maxWidth = Math.max(1, Math.floor(maxWidthCells));
    const maxHeight =
      maxHeightCells === undefined ? undefined : Math.max(1, Math.floor(maxHeightCells));
    const imageWidth = Math.max(1, imageDimensions.widthPx);
    const imageHeight = Math.max(1, imageDimensions.heightPx);

    const widthScale = (maxWidth * cellSize.widthPx) / imageWidth;
    const heightScale =
      maxHeight === undefined ? widthScale : (maxHeight * cellSize.heightPx) / imageHeight;
    const scale = Math.min(widthScale, heightScale);

    const scaledWidthPx = imageWidth * scale;
    const scaledHeightPx = imageHeight * scale;
    let columns = Math.max(1, Math.min(maxWidth, Math.ceil(scaledWidthPx / cellSize.widthPx)));
    const heightRows = scaledHeightPx / cellSize.heightPx;
    let rows = Math.max(1, Math.ceil(heightRows));
    if (maxHeight !== undefined) {
      rows = Math.min(maxHeight, rows);
    }

    if (!optimizeAspectRatio) {
      return { columns, rows };
    }

    if (widthScale <= heightScale) {
      const idealRows =
        (columns * cellSize.widthPx * imageHeight) / (imageWidth * getCellDimensions().heightPx);
      rows = chooseLessDistortedCellCount(rows, idealRows);
    } else {
      const idealColumns =
        (rows * cellSize.heightPx * imageWidth) / (imageHeight * getCellDimensions().widthPx);
      columns = chooseLessDistortedCellCount(columns, idealColumns);
    }

    return { columns, rows };
  },
);

export const calculateImageRows: {
  (imageDimensions: ImageDimensions, targetWidthCells: number, cellSize?: CellDimensions): number;
  (
    targetWidthCells: number,
    cellSize?: CellDimensions,
  ): (imageDimensions: ImageDimensions) => number;
} = dual(
  (args) => typeof args[0] === "object" && args[0] !== null && !Array.isArray(args[0]),
  (
    imageDimensions: ImageDimensions,
    targetWidthCells: number,
    cellSize: CellDimensions = { widthPx: 9, heightPx: 18 },
  ): number => calculateImageCellSize(imageDimensions, targetWidthCells, undefined, cellSize).rows,
);

export function getPngDimensions(base64Data: string): ImageDimensions | null {
  try {
    const buffer = Buffer.from(base64Data, "base64");

    if (buffer.length < 24) {
      return null;
    }

    if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) {
      return null;
    }

    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);

    return { widthPx: width, heightPx: height };
  } catch {
    return null;
  }
}

export function getJpegDimensions(base64Data: string): ImageDimensions | null {
  try {
    const buffer = Buffer.from(base64Data, "base64");

    if (buffer.length < 2) {
      return null;
    }

    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
      return null;
    }

    let offset = 2;
    while (offset < buffer.length - 9) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }

      const marker = buffer.readUInt8(offset + 1);

      if (marker >= 0xc0 && marker <= 0xc2) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { widthPx: width, heightPx: height };
      }

      if (offset + 3 >= buffer.length) {
        return null;
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) {
        return null;
      }
      offset += 2 + length;
    }

    return null;
  } catch {
    return null;
  }
}

export function getGifDimensions(base64Data: string): ImageDimensions | null {
  try {
    const buffer = Buffer.from(base64Data, "base64");

    if (buffer.length < 10) {
      return null;
    }

    const sig = buffer.slice(0, 6).toString("ascii");
    if (sig !== "GIF87a" && sig !== "GIF89a") {
      return null;
    }

    const width = buffer.readUInt16LE(6);
    const height = buffer.readUInt16LE(8);

    return { widthPx: width, heightPx: height };
  } catch {
    return null;
  }
}

export function getWebpDimensions(base64Data: string): ImageDimensions | null {
  try {
    const buffer = Buffer.from(base64Data, "base64");

    if (buffer.length < 30) {
      return null;
    }

    const riff = buffer.slice(0, 4).toString("ascii");
    const webp = buffer.slice(8, 12).toString("ascii");
    if (riff !== "RIFF" || webp !== "WEBP") {
      return null;
    }

    const chunk = buffer.slice(12, 16).toString("ascii");
    if (chunk === "VP8 ") {
      if (buffer.length < 30) return null;
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      return { widthPx: width, heightPx: height };
    } else if (chunk === "VP8L") {
      if (buffer.length < 25) return null;
      const bits = buffer.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return { widthPx: width, heightPx: height };
    } else if (chunk === "VP8X") {
      if (buffer.length < 30) return null;
      const width = buffer.readUIntLE(24, 3) + 1;
      const height = buffer.readUIntLE(27, 3) + 1;
      return { widthPx: width, heightPx: height };
    }

    return null;
  } catch {
    return null;
  }
}

export const getImageDimensions: {
  (base64Data: string, mimeType: string): ImageDimensions | null;
  (mimeType: string): (base64Data: string) => ImageDimensions | null;
} = dual(2, (base64Data: string, mimeType: string): ImageDimensions | null => {
  if (mimeType === "image/png") {
    return getPngDimensions(base64Data);
  }
  if (mimeType === "image/jpeg") {
    return getJpegDimensions(base64Data);
  }
  if (mimeType === "image/gif") {
    return getGifDimensions(base64Data);
  }
  if (mimeType === "image/webp") {
    return getWebpDimensions(base64Data);
  }
  return null;
});

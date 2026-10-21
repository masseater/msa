import { crc32, deflateSync } from "node:zlib";

import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import toolResultImages from "../src/utils/tool-result-images.ts";
import type toolResultImagesTypes from "../src/utils/tool-result-images.types.ts";

const { normalizeToolResultImages } = toolResultImages;

const { awaited, runTest } = testing;

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

function pngChunk(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length, 0);
  header.write(type, 4, "ascii");
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), body])), 0);
  return Buffer.concat([header, body, checksum]);
}

function createPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  for (let row = 0; row < height; row++) {
    raw.fill(row % 256, row * (width + 1) + 1, (row + 1) * (width + 1));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function readPngDimensions(base64Data: string): { width: number; height: number } {
  const buffer = Buffer.from(base64Data, "base64");
  return { height: buffer.readUInt32BE(20), width: buffer.readUInt32BE(16) };
}

function createTinyBmp1x1Red24bpp(): Buffer {
  const buffer = Buffer.alloc(58);
  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(1, 18);
  buffer.writeInt32LE(1, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(0, 30);
  buffer.writeUInt32LE(4, 34);
  buffer[56] = 0xff;
  return buffer;
}

function imageBlock(bytes: Buffer, mimeType: string): toolResultImagesTypes.ToolResultContent {
  return { data: bytes.toString("base64"), mimeType, type: "image" };
}

const returnsTheOriginalArrayWhenThereAre = () =>
  runTest(
    Effect.gen(function* () {
      const content: toolResultImagesTypes.ToolResultContent[] = [
        { text: "no images here", type: "text" },
      ];

      expect(yield* awaited(normalizeToolResultImages(content))).toBe(content);
    }),
  );

const returnsTheOriginalArrayWhenImagesAre = () =>
  runTest(
    Effect.gen(function* () {
      const content: toolResultImagesTypes.ToolResultContent[] = [
        { text: "screenshot", type: "text" },
        { data: TINY_PNG_BASE64, mimeType: "image/png", type: "image" },
      ];

      expect(yield* awaited(normalizeToolResultImages(content))).toBe(content);
    }),
  );

const resizesOversizedImagesAndReportsTheOriginal = () =>
  runTest(
    Effect.gen(function* () {
      const content: toolResultImagesTypes.ToolResultContent[] = [
        imageBlock(createPng(2400, 4800), "image/png"),
      ];

      const normalized = yield* awaited(normalizeToolResultImages(content));

      expect(normalized).not.toBe(content);
      expect(normalized).toHaveLength(2);
      const image = normalized[0];
      expect(image?.type).toBe("image");
      if (image?.type !== "image") return;
      const { width, height } = readPngDimensions(image.data);
      expect(width).toBeLessThanOrEqual(2000);
      expect(height).toBeLessThanOrEqual(2000);
      const note = normalized[1];
      expect(note?.type).toBe("text");
      if (note?.type !== "text") return;
      expect(note.text).toContain("original 2400x4800");
    }),
  );

const leavesOversizedImagesAloneWhenAutoResize = () =>
  runTest(
    Effect.gen(function* () {
      const content: toolResultImagesTypes.ToolResultContent[] = [
        imageBlock(createPng(2400, 4800), "image/png"),
      ];

      const normalized = yield* awaited(
        normalizeToolResultImages(content, { autoResizeImages: false }),
      );

      expect(normalized).toBe(content);
    }),
  );

const convertsUnsupportedImageFormatsEvenWhenAuto = () =>
  runTest(
    Effect.gen(function* () {
      const content: toolResultImagesTypes.ToolResultContent[] = [
        imageBlock(createTinyBmp1x1Red24bpp(), "image/bmp"),
      ];

      const normalized = yield* awaited(
        normalizeToolResultImages(content, { autoResizeImages: false }),
      );

      expect(normalized).not.toBe(content);
      expect(normalized[0]).toMatchObject({ mimeType: "image/png", type: "image" });
      expect(normalized[1]).toMatchObject({
        text: "[Image converted from image/bmp to image/png.]",
        type: "text",
      });
    }),
  );

const keepsUndecodableImagesInsteadOfDroppingTool = () =>
  runTest(
    Effect.gen(function* () {
      const content: toolResultImagesTypes.ToolResultContent[] = [
        { data: "bm90LWFuLWltYWdl", mimeType: "image/png", type: "image" },
      ];

      expect(yield* awaited(normalizeToolResultImages(content))).toBe(content);
    }),
  );

const preservesSurroundingTextBlocksAndTheirOrder = () =>
  runTest(
    Effect.gen(function* () {
      const content: toolResultImagesTypes.ToolResultContent[] = [
        { text: "before", type: "text" },
        imageBlock(createPng(2400, 100), "image/png"),
        { text: "after", type: "text" },
      ];

      const normalized = yield* awaited(normalizeToolResultImages(content));

      expect(normalized.map((block) => block.type)).toEqual(["text", "image", "text", "text"]);
      expect(normalized[0]).toEqual({ text: "before", type: "text" });
      expect(normalized[3]).toEqual({ text: "after", type: "text" });
    }),
  );

describe("normalizeToolResultImages", () => {
  it(
    "returns the original array when there are no image blocks",
    returnsTheOriginalArrayWhenThereAre,
  );

  it(
    "returns the original array when images are already within limits",
    returnsTheOriginalArrayWhenImagesAre,
  );

  it(
    "resizes oversized images and reports the original dimensions",
    resizesOversizedImagesAndReportsTheOriginal,
  );

  it(
    "leaves oversized images alone when auto-resize is disabled",
    leavesOversizedImagesAloneWhenAutoResize,
  );

  it(
    "converts unsupported image formats even when auto-resize is disabled",
    convertsUnsupportedImageFormatsEvenWhenAuto,
  );

  it(
    "keeps undecodable images instead of dropping tool output",
    keepsUndecodableImagesInsteadOfDroppingTool,
  );

  it(
    "preserves surrounding text blocks and their order",
    preservesSurroundingTextBlocksAndTheirOrder,
  );
});

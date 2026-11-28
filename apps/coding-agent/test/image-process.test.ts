import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import imageProcess from "../src/utils/image-process.ts";
import mime from "../src/utils/mime.ts";
import imageFixtureSupport from "./image-fixture-support.ts";

const { createTinyBmp1x1Red24bpp } = imageFixtureSupport;

const { detectSupportedImageMimeType } = mime;
const { processImage } = imageProcess;

const { awaited, runTest } = testing;

function expectPngMagic(base64Data: string): void {
  const buffer = Buffer.from(base64Data, "base64");
  expect(buffer[0]).toBe(0x89);
  expect(buffer[1]).toBe(0x50);
  expect(buffer[2]).toBe(0x4e);
  expect(buffer[3]).toBe(0x47);
}

const detectsBmpFilesFromMagicBytes = () => {
  expect(detectSupportedImageMimeType(createTinyBmp1x1Red24bpp())).toBe("image/bmp");
};

const convertsBmpFilesToPngAttachmentsWhen = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(
        processImage(createTinyBmp1x1Red24bpp(), "image/bmp", {
          autoResizeImages: false,
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.mimeType).toBe("image/png");
      expect(result.hints).toContain("[Image converted from image/bmp to image/png.]");
      expectPngMagic(result.data);
    }),
  );

const convertsBmpFilesBeforeAutoResizing = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(processImage(createTinyBmp1x1Red24bpp(), "image/bmp"));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.mimeType).toBe("image/png");
      expect(result.hints).toContain("[Image converted from image/bmp to image/png.]");
      expectPngMagic(result.data);
    }),
  );

describe("image processing pipeline", () => {
  it.each(["GIF87a", "GIF89a"])("detects the complete %s signature", (signature) => {
    expect(detectSupportedImageMimeType(Buffer.from(signature, "ascii"))).toBe("image/gif");
  });

  it("detects BMP files from magic bytes", detectsBmpFilesFromMagicBytes);

  it(
    "converts BMP files to PNG attachments when auto-resize is disabled",
    convertsBmpFilesToPngAttachmentsWhen,
  );

  it("converts BMP files before auto-resizing", convertsBmpFilesBeforeAutoResizing);
});

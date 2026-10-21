import { tmpdir } from "os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import fileProcessor from "../src/cli/file-processor.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import read from "../src/core/tools/read.ts";
const { createReadTool } = read;
const { processFileArguments } = fileProcessor;

const {
  awaited,
  currentTimeMillis,
  joinPath,
  makeDirectory,
  removePath,
  runTest,
  writeBytesFile,
  writeTextFile,
} = testing;

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

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

let testDir2: string;

let testDir3: string;

const shouldDefaultBlockimagesToFalse = () => {
  const manager = SettingsManager.inMemory({});
  expect(manager.display.getBlockImages()).toBe(false);
};

const shouldReturnTrueWhenBlockimagesIsSet = () => {
  const manager = SettingsManager.inMemory({ images: { blockImages: true } });
  expect(manager.display.getBlockImages()).toBe(true);
};

const shouldPersistBlockimagesSettingViaSetblockimages = () => {
  const manager = SettingsManager.inMemory({});
  expect(manager.display.getBlockImages()).toBe(false);

  manager.display.setBlockImages(true);
  expect(manager.display.getBlockImages()).toBe(true);

  manager.display.setBlockImages(false);
  expect(manager.display.getBlockImages()).toBe(false);
};

const shouldHandleBlockimagesAlongsideAutoresize = () => {
  const manager = SettingsManager.inMemory({
    images: { autoResize: true, blockImages: true },
  });
  expect(manager.display.getImageAutoResize()).toBe(true);
  expect(manager.display.getBlockImages()).toBe(true);
};

const shouldAlwaysReadImagesFilteringHappensAt = () =>
  runTest(
    Effect.gen(function* () {
      const imagePath = joinPath(testDir2, "test.png");
      yield* writeBytesFile(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));

      const tool = createReadTool(testDir2);
      const result = yield* awaited(tool.execute("test-1", { path: imagePath }));

      expect(result.content.length).toBeGreaterThanOrEqual(1);
      const hasImage = result.content.some((c) => c.type === "image");
      expect(hasImage).toBe(true);
    }),
  );

const shouldReadTextFilesNormally = () =>
  runTest(
    Effect.gen(function* () {
      const textPath = joinPath(testDir2, "test.txt");
      yield* writeTextFile(textPath, "Hello, world!");

      const tool = createReadTool(testDir2);
      const result = yield* awaited(tool.execute("test-2", { path: textPath }));

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("text");
      const textContent = result.content[0] as { type: "text"; text: string };
      expect(textContent.text).toContain("Hello, world!");
    }),
  );

const shouldAlwaysProcessImagesFilteringHappensAt = () =>
  runTest(
    Effect.gen(function* () {
      const imagePath = joinPath(testDir3, "test.png");
      yield* writeBytesFile(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));

      const result = yield* awaited(processFileArguments([imagePath]));

      expect(result.images).toHaveLength(1);
      expect(result.images[0]?.type).toBe("image");
    }),
  );

const shouldProcessBmpImagesFromDiskAs = () =>
  runTest(
    Effect.gen(function* () {
      const imagePath = joinPath(testDir3, "test.bmp");
      yield* writeBytesFile(imagePath, createTinyBmp1x1Red24bpp());

      const result = yield* awaited(processFileArguments([imagePath]));

      expect(result.images).toHaveLength(1);
      expect(result.images[0]?.type).toBe("image");
      expect(result.images[0]?.mimeType).toBe("image/png");
      expect(result.text).toContain("[Image converted from image/bmp to image/png.]");
    }),
  );

const shouldProcessTextFilesNormally = () =>
  runTest(
    Effect.gen(function* () {
      const textPath = joinPath(testDir3, "test.txt");
      yield* writeTextFile(textPath, "Hello, world!");

      const result = yield* awaited(processFileArguments([textPath]));

      expect(result.images).toHaveLength(0);
      expect(result.text).toContain("Hello, world!");
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      testDir2 = joinPath(tmpdir(), `block-images-test-${currentTimeMillis()}`);
      yield* makeDirectory(testDir2);
    }),
  );

describe("blockImages setting", () => {
  describe("SettingsManager", () => {
    it("should default blockImages to false", shouldDefaultBlockimagesToFalse);

    it("should return true when blockImages is set to true", shouldReturnTrueWhenBlockimagesIsSet);

    it(
      "should persist blockImages setting via setBlockImages",
      shouldPersistBlockimagesSettingViaSetblockimages,
    );

    it(
      "should handle blockImages alongside autoResize",
      shouldHandleBlockimagesAlongsideAutoresize,
    );
  });

  describe("Read tool", () => {
    beforeEach(beforeEachHook);

    afterEach(() => runTest(removePath(testDir2)));

    it(
      "should always read images (filtering happens at convertToLlm layer)",
      shouldAlwaysReadImagesFilteringHappensAt,
    );

    it("should read text files normally", shouldReadTextFilesNormally);
  });
});

const beforeEachHook2 = () =>
  runTest(
    Effect.gen(function* () {
      testDir3 = joinPath(tmpdir(), `block-images-process-test-${currentTimeMillis()}`);
      yield* makeDirectory(testDir3);
    }),
  );

describe("blockImages setting", () => {
  describe("processFileArguments", () => {
    beforeEach(beforeEachHook2);

    afterEach(() => runTest(removePath(testDir3)));

    it(
      "should always process images (filtering happens at convertToLlm layer)",
      shouldAlwaysProcessImagesFilteringHappensAt,
    );

    it("should process BMP images from disk as PNG attachments", shouldProcessBmpImagesFromDiskAs);

    it("should process text files normally", shouldProcessTextFilesNormally);
  });
});

import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import fileProcessor from "../src/cli/file-processor.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import read from "../src/core/tools/read.ts";
import imageFixtureSupport from "./image-fixture-support.ts";
import tempDir from "./temp-dir.ts";

const { createTinyBmp1x1Red24bpp } = imageFixtureSupport;
const { createReadTool } = read;
const { useTempDir } = tempDir;
const { processFileArguments } = fileProcessor;

const readDir = useTempDir("block-images-test-");

const processDir = useTempDir("block-images-process-test-");

const { awaited, joinPath, runTest, writeBytesFile, writeTextFile } = testing;

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

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
      const imagePath = joinPath(readDir.path, "test.png");
      yield* writeBytesFile(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));

      const tool = createReadTool(readDir.path);
      const result = yield* awaited(tool.execute("test-1", { path: imagePath }));

      expect(result.content.length).toBeGreaterThanOrEqual(1);
      const hasImage = result.content.some((c) => c.type === "image");
      expect(hasImage).toBe(true);
    }),
  );

const shouldReadTextFilesNormally = () =>
  runTest(
    Effect.gen(function* () {
      const textPath = joinPath(readDir.path, "test.txt");
      yield* writeTextFile(textPath, "Hello, world!");

      const tool = createReadTool(readDir.path);
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
      const imagePath = joinPath(processDir.path, "test.png");
      yield* writeBytesFile(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));

      const result = yield* awaited(processFileArguments([imagePath]));

      expect(result.images).toHaveLength(1);
      expect(result.images[0]?.type).toBe("image");
    }),
  );

const shouldProcessBmpImagesFromDiskAs = () =>
  runTest(
    Effect.gen(function* () {
      const imagePath = joinPath(processDir.path, "test.bmp");
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
      const textPath = joinPath(processDir.path, "test.txt");
      yield* writeTextFile(textPath, "Hello, world!");

      const result = yield* awaited(processFileArguments([textPath]));

      expect(result.images).toHaveLength(0);
      expect(result.text).toContain("Hello, world!");
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
    it(
      "should always read images (filtering happens at convertToLlm layer)",
      shouldAlwaysReadImagesFilteringHappensAt,
    );

    it("should read text files normally", shouldReadTextFilesNormally);
  });
});

describe("blockImages setting", () => {
  describe("processFileArguments", () => {
    it(
      "should always process images (filtering happens at convertToLlm layer)",
      shouldAlwaysProcessImagesFilteringHappensAt,
    );

    it("should process BMP images from disk as PNG attachments", shouldProcessBmpImagesFromDiskAs);

    it("should process text files normally", shouldProcessTextFilesNormally);
  });
});

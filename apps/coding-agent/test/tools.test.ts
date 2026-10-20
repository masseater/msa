import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createReadTool } from "../src/index.ts";

const { awaited, joinPath, makeTempDir, removePath, runTest, writeBytesFile, writeTextFile } =
  testing;

const readTool = createReadTool(process.cwd());

function getTextOutput(result: any): string {
  return (
    result.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n") || ""
  );
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

let testDir = "";

beforeEach(() =>
  runTest(makeTempDir("coding-agent-tools-")).then((dir) => {
    testDir = dir;
    return dir;
  }),
);

afterEach(() => {
  vi.restoreAllMocks();
  return runTest(removePath(testDir));
});

const shouldReadFileContentsThatFitWithin = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "test.txt");
      const content = "Hello, world!\nLine 2\nLine 3";
      yield* writeTextFile(testFile, content);

      const result = yield* awaited(readTool.execute("test-call-1", { path: testFile }));

      expect(getTextOutput(result)).toBe(content);

      expect(getTextOutput(result)).not.toContain("Use offset=");
      expect(result.details).toBeUndefined();
      expect(result.structuredContent).toBe(content);
    }),
  );

const shouldHandleNonExistentFiles = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "nonexistent.txt");

      yield* awaited(
        expect(readTool.execute("test-call-2", { path: testFile })).rejects.toThrow(
          /ENOENT|not found/iu,
        ),
      );
    }),
  );

const shouldTruncateFilesExceedingLineLimit = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "large.txt");
      const lines = Array.from({ length: 2500 }, (_, i) => `Line ${i + 1}`);
      yield* writeTextFile(testFile, lines.join("\n"));

      const result = yield* awaited(readTool.execute("test-call-3", { path: testFile }));
      const output = getTextOutput(result);

      expect(output).toContain("Line 1");
      expect(output).toContain("Line 2000");
      expect(output).not.toContain("Line 2001");
      expect(output).toContain("[Showing lines 1-2000 of 2500. Use offset=2001 to continue.]");
    }),
  );

const shouldTruncateWhenByteLimitExceeded = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "large-bytes.txt");

      const lines = Array.from({ length: 500 }, (_, i) => `Line ${i + 1}: ${"x".repeat(200)}`);
      yield* writeTextFile(testFile, lines.join("\n"));

      const result = yield* awaited(readTool.execute("test-call-4", { path: testFile }));
      const output = getTextOutput(result);

      expect(output).toContain("Line 1:");

      expect(output).toMatch(
        /\[Showing lines 1-\d+ of 500 \(.* limit\)\. Use offset=\d+ to continue\.\]/u,
      );
    }),
  );

const shouldHandleOffsetParameter = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "offset-test.txt");
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
      yield* writeTextFile(testFile, lines.join("\n"));

      const result = yield* awaited(
        readTool.execute("test-call-5", { offset: 51, path: testFile }),
      );
      const output = getTextOutput(result);

      expect(output).not.toContain("Line 50");
      expect(output).toContain("Line 51");
      expect(output).toContain("Line 100");

      expect(output).not.toContain("Use offset=");
    }),
  );

const shouldHandleLimitParameter = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "limit-test.txt");
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
      yield* writeTextFile(testFile, lines.join("\n"));

      const result = yield* awaited(readTool.execute("test-call-6", { limit: 10, path: testFile }));
      const output = getTextOutput(result);

      expect(output).toContain("Line 1");
      expect(output).toContain("Line 10");
      expect(output).not.toContain("Line 11");
      expect(output).toContain("[90 more lines in file. Use offset=11 to continue.]");
    }),
  );

const shouldHandleOffsetLimitTogether = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "offset-limit-test.txt");
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
      yield* writeTextFile(testFile, lines.join("\n"));

      const result = yield* awaited(
        readTool.execute("test-call-7", {
          limit: 20,
          offset: 41,
          path: testFile,
        }),
      );
      const output = getTextOutput(result);

      expect(output).not.toContain("Line 40");
      expect(output).toContain("Line 41");
      expect(output).toContain("Line 60");
      expect(output).not.toContain("Line 61");
      expect(output).toContain("[40 more lines in file. Use offset=61 to continue.]");
    }),
  );

const shouldShowErrorWhenOffsetIsBeyond = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "short.txt");
      yield* writeTextFile(testFile, "Line 1\nLine 2\nLine 3");

      yield* awaited(
        expect(readTool.execute("test-call-8", { offset: 100, path: testFile })).rejects.toThrow(
          /Offset 100 is beyond end of file \(3 lines total\)/u,
        ),
      );
    }),
  );

const shouldIncludeTruncationDetailsWhenTruncated = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "large-file.txt");
      const lines = Array.from({ length: 2500 }, (_, i) => `Line ${i + 1}`);
      yield* writeTextFile(testFile, lines.join("\n"));

      const result = yield* awaited(readTool.execute("test-call-9", { path: testFile }));

      expect(result.details).toBeDefined();
      expect(result.details?.truncation).toBeDefined();
      expect(result.details?.truncation?.truncated).toBe(true);
      expect(result.details?.truncation?.truncatedBy).toBe("lines");
      expect(result.details?.truncation?.totalLines).toBe(2500);
      expect(result.details?.truncation?.outputLines).toBe(2000);
    }),
  );

const shouldDetectImageMimeTypeFromFile = () =>
  runTest(
    Effect.gen(function* () {
      const png1x1Base64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==";
      const pngBuffer = Buffer.from(png1x1Base64, "base64");

      const testFile = joinPath(testDir, "image.txt");
      yield* writeBytesFile(testFile, pngBuffer);

      const result = yield* awaited(readTool.execute("test-call-img-1", { path: testFile }));

      expect(result.content[0]?.type).toBe("text");
      expect(getTextOutput(result)).toContain("Read image file [image/png]");

      const imageBlock = result.content.find(
        (c): c is { type: "image"; mimeType: string; data: string } => c.type === "image",
      );
      expect(imageBlock).toBeDefined();
      expect(imageBlock?.mimeType).toBe("image/png");
      expect(typeof imageBlock?.data).toBe("string");
      expect((imageBlock?.data ?? "").length).toBeGreaterThan(0);

      expect(result.structuredContent).toEqual({
        data: imageBlock?.data,
        mimeType: "image/png",
        note: getTextOutput(result),
        type: "image",
      });
    }),
  );

const shouldReadBmpFilesFromDiskAs = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "image.bmp");
      yield* writeBytesFile(testFile, createTinyBmp1x1Red24bpp());

      const result = yield* awaited(readTool.execute("test-call-img-bmp", { path: testFile }));

      expect(result.content[0]?.type).toBe("text");
      expect(getTextOutput(result)).toContain("Read image file [image/png]");
      expect(getTextOutput(result)).toContain("[Image converted from image/bmp to image/png.]");

      const imageBlock = result.content.find(
        (c): c is { type: "image"; mimeType: string; data: string } => c.type === "image",
      );
      expect(imageBlock).toBeDefined();
      expect(imageBlock?.mimeType).toBe("image/png");
      expect(Buffer.from(imageBlock?.data ?? "", "base64")[0]).toBe(0x89);
    }),
  );

describe("read tool", () => {
  it("should read file contents that fit within limits", shouldReadFileContentsThatFitWithin);

  it("should handle non-existent files", shouldHandleNonExistentFiles);

  it("should truncate files exceeding line limit", shouldTruncateFilesExceedingLineLimit);

  it("should truncate when byte limit exceeded", shouldTruncateWhenByteLimitExceeded);

  it("should handle offset parameter", shouldHandleOffsetParameter);

  it("should handle limit parameter", shouldHandleLimitParameter);

  it("should handle offset + limit together", shouldHandleOffsetLimitTogether);

  it("should show error when offset is beyond file length", shouldShowErrorWhenOffsetIsBeyond);

  it(
    "should include truncation details when truncated",
    shouldIncludeTruncationDetailsWhenTruncated,
  );

  it(
    "should detect image MIME type from file magic (not extension)",
    shouldDetectImageMimeTypeFromFile,
  );

  it("should read BMP files from disk as PNG image attachments", shouldReadBmpFilesFromDiskAs);
});

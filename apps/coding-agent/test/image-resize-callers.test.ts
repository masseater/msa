import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const resizeImageMock = vi.hoisted(() =>
  vi.fn((_bytes: Uint8Array, _mimeType: string, _options?: unknown): Promise<null> =>
    Promise.resolve(null),
  ),
);

vi.mock("../src/utils/image-resize.js", () => ({
  default: {
    formatDimensionNote: vi.fn(() => undefined),
    resizeImage: resizeImageMock,
  },
}));

import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";

import fileProcessor from "../src/cli/file-processor.ts";
import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";
import read from "../src/core/tools/read.ts";

const { createReadTool, createReadToolDefinition } = read;
const { processFileArguments } = fileProcessor;

const { awaited, currentTimeMillis, joinPath, makeDirectory, removePath, runTest, writeBytesFile } =
  testing;

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

let testDir: string;

const readToolReturnsTextOnlyOutputWhen = () =>
  runTest(
    Effect.gen(function* () {
      const imagePath = joinPath(testDir, "test.png");
      yield* writeBytesFile(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));

      const tool = createReadTool(testDir);
      const result = yield* awaited(tool.execute("test-read-image", { path: imagePath }));

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("text");
      expect((result.content[0] as { type: "text"; text: string }).text).toContain("Image omitted");
    }),
  );

const fileProcessorOmitsImageAttachmentsWhenAuto = () =>
  runTest(
    Effect.gen(function* () {
      const imagePath = joinPath(testDir, "test.png");
      yield* writeBytesFile(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));

      const result = yield* awaited(processFileArguments([imagePath]));

      expect(result.images).toHaveLength(0);
      expect(result.text).toContain("Image omitted");
    }),
  );

const passesTheCurrentModelResizeProfileTo = () =>
  runTest(
    Effect.gen(function* () {
      const imagePath = joinPath(testDir, "test.png");
      yield* writeBytesFile(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));
      const resize = { jpegQuality: 70, maxBytes: 500000, maxHeight: 1000, maxWidth: 1234 };
      const model: aiTypes.Model<aiTypes.Api> = {
        api: "test" as const,
        baseUrl: "https://example.com",
        contextWindow: 1000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "vision-model",
        input: ["text", "image"],
        inputLimits: { images: { resize } },
        maxTokens: 100,
        name: "Vision model",
        provider: "test",
        reasoning: false,
      };
      const ctx = { cwd: testDir, model } as unknown as extensionsTypesTypes.ExtensionToolContext;

      yield* awaited(
        createReadToolDefinition(testDir).execute(
          "test-read-model-profile",
          { path: imagePath },
          undefined,
          undefined,
          ctx,
        ),
      );

      expect(resizeImageMock).toHaveBeenCalledWith(expect.any(Uint8Array), "image/png", resize);
    }),
  );

const canDeferResizingFileAttachmentsUntilPrompt = () =>
  runTest(
    Effect.gen(function* () {
      const imagePath = joinPath(testDir, "test.png");
      yield* writeBytesFile(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));

      const result = yield* awaited(processFileArguments([imagePath], { autoResizeImages: false }));

      expect(result.images).toHaveLength(1);
      expect(resizeImageMock).not.toHaveBeenCalled();
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      testDir = joinPath(tmpdir(), `image-resize-callers-${currentTimeMillis()}`);
      yield* makeDirectory(testDir);
      resizeImageMock.mockReset();
      resizeImageMock.mockResolvedValue(null);
    }),
  );

describe("image resize callers", () => {
  beforeEach(beforeEachHook);

  afterEach(() => runTest(removePath(testDir)));

  it(
    "read tool returns text-only output when auto-resize cannot produce a safe image",
    readToolReturnsTextOnlyOutputWhen,
  );

  it(
    "file processor omits image attachments when auto-resize cannot produce a safe image",
    fileProcessorOmitsImageAttachmentsWhenAuto,
  );

  it(
    "passes the current model resize profile to the read tool",
    passesTheCurrentModelResizeProfileTo,
  );

  it(
    "can defer resizing file attachments until prompt dispatch",
    canDeferResizingFileAttachmentsUntilPrompt,
  );
});

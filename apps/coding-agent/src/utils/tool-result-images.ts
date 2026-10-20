import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../core/awaiting.ts";
import imageProcess from "./image-process.ts";
import type toolResultImagesTypes from "./tool-result-images.types.ts";

const { awaited, awaiting } = awaitingModule;
const { processImage } = imageProcess;

function* normalizeImageBlock(
  block: Extract<toolResultImagesTypes.ToolResultContent, { type: "image" }>,
  options: toolResultImagesTypes.NormalizeToolResultImagesOptions | undefined,
): Generator<
  Effect.Effect<unknown>,
  toolResultImagesTypes.ToolResultContent[] | undefined,
  unknown
> {
  const processed = yield* awaited(
    processImage(Buffer.from(block.data, "base64"), block.mimeType, {
      autoResizeImages: options?.autoResizeImages ?? true,
      resizeOptions: options?.resizeOptions,
    }),
  );
  if (!processed.ok) return undefined;
  if (
    processed.data === block.data &&
    processed.mimeType === block.mimeType &&
    processed.hints.length === 0
  )
    return undefined;
  const next: toolResultImagesTypes.ToolResultContent[] = [
    { data: processed.data, mimeType: processed.mimeType, type: "image" },
  ];
  if (processed.hints.length > 0) next.push({ text: processed.hints.join("\n"), type: "text" });
  return next;
}

function normalizeToolResultImagesImpl(
  content: toolResultImagesTypes.ToolResultContent[],
  options?: toolResultImagesTypes.NormalizeToolResultImagesOptions,
): Promise<toolResultImagesTypes.ToolResultContent[]> {
  return Effect.runPromise(
    awaiting(function* () {
      if (!content.some((block) => block.type === "image")) return content;

      const normalized: toolResultImagesTypes.ToolResultContent[] = [];
      let changed = false;
      for (const block of content) {
        if (block.type !== "image") {
          normalized.push(block);
          continue;
        }
        const replaced = yield* normalizeImageBlock(block, options);
        if (replaced === undefined) {
          normalized.push(block);
          continue;
        }
        normalized.push(...replaced);
        changed = true;
      }
      return changed ? normalized : content;
    }),
  );
}

const normalizeToolResultImages: {
  (
    content: toolResultImagesTypes.ToolResultContent[],
    options?: toolResultImagesTypes.NormalizeToolResultImagesOptions,
  ): Promise<toolResultImagesTypes.ToolResultContent[]>;
  (
    options?: toolResultImagesTypes.NormalizeToolResultImagesOptions,
  ): (
    content: toolResultImagesTypes.ToolResultContent[],
  ) => Promise<toolResultImagesTypes.ToolResultContent[]>;
} = dual((args: IArguments) => args.length >= 1, normalizeToolResultImagesImpl);

const toolResultImages = {
  normalizeToolResultImages,
};

export default toolResultImages;

import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import { awaited, awaiting } from "../core/awaiting.ts";
import { processImage } from "./image-process.ts";

export type ToolResultContent = aiTypes.TextContent | aiTypes.ImageContent;

export interface NormalizeToolResultImagesOptions {
  autoResizeImages?: boolean;

  resizeOptions?: aiTypes.ModelImageResizeOptions;
}

function* normalizeImageBlock(
  block: Extract<ToolResultContent, { type: "image" }>,
  options: NormalizeToolResultImagesOptions | undefined,
): Generator<Effect.Effect<unknown>, ToolResultContent[] | undefined, unknown> {
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
  const next: ToolResultContent[] = [
    { data: processed.data, mimeType: processed.mimeType, type: "image" },
  ];
  if (processed.hints.length > 0) next.push({ text: processed.hints.join("\n"), type: "text" });
  return next;
}

function normalizeToolResultImagesImpl(
  content: ToolResultContent[],
  options?: NormalizeToolResultImagesOptions,
): Promise<ToolResultContent[]> {
  return Effect.runPromise(
    awaiting(function* () {
      if (!content.some((block) => block.type === "image")) return content;

      const normalized: ToolResultContent[] = [];
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

export const normalizeToolResultImages: {
  (
    content: ToolResultContent[],
    options?: NormalizeToolResultImagesOptions,
  ): Promise<ToolResultContent[]>;
  (
    options?: NormalizeToolResultImagesOptions,
  ): (content: ToolResultContent[]) => Promise<ToolResultContent[]>;
} = dual((args: IArguments) => args.length >= 1, normalizeToolResultImagesImpl);

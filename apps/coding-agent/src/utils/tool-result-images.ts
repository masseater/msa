import type { ImageContent, ModelImageResizeOptions, TextContent } from "@msa/ai";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import { awaited, awaiting } from "../core/awaiting.ts";
import { processImage } from "./image-process.ts";

export type ToolResultContent = TextContent | ImageContent;

export interface NormalizeToolResultImagesOptions {
  autoResizeImages?: boolean;

  resizeOptions?: ModelImageResizeOptions;
}

function normalizeToolResultImagesImpl(
  content: ToolResultContent[],
  options?: NormalizeToolResultImagesOptions,
): Promise<ToolResultContent[]> {
  return Effect.runPromise(
    awaiting(function* () {
      if (!content.some((block) => block.type === "image")) {
        return content;
      }

      const autoResizeImages = options?.autoResizeImages ?? true;
      const normalized: ToolResultContent[] = [];
      let changed = false;

      for (const block of content) {
        if (block.type !== "image") {
          normalized.push(block);
          continue;
        }

        const processed = yield* awaited(
          processImage(Buffer.from(block.data, "base64"), block.mimeType, {
            autoResizeImages,
            resizeOptions: options?.resizeOptions,
          }),
        );
        if (!processed.ok) {
          normalized.push(block);
          continue;
        }

        if (
          processed.data === block.data &&
          processed.mimeType === block.mimeType &&
          processed.hints.length === 0
        ) {
          normalized.push(block);
          continue;
        }

        normalized.push({ type: "image", data: processed.data, mimeType: processed.mimeType });
        if (processed.hints.length > 0) {
          normalized.push({ type: "text", text: processed.hints.join("\n") });
        }
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

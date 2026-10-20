import { dual } from "effect/Function";

import type {
  MarkdownTransformContext,
  MarkdownTransformer,
} from "../../../core/extensions/types.ts";

export const createMarkdownTransform: {
  (
    isStreaming: boolean,
    transformers: readonly MarkdownTransformer[],
  ): (
    messageType: MarkdownTransformContext["messageType"],
  ) => (markdown: string, availableWidth: number) => string;
  (
    messageType: MarkdownTransformContext["messageType"],
    isStreaming: boolean,
    transformers: readonly MarkdownTransformer[],
  ): (markdown: string, availableWidth: number) => string;
} = dual(
  3,
  (
    messageType: MarkdownTransformContext["messageType"],
    isStreaming: boolean,
    transformers: readonly MarkdownTransformer[],
  ): ((markdown: string, availableWidth: number) => string) =>
    (markdown, availableWidth) =>
      applyMarkdownTransformers(
        markdown,
        { availableWidth, isStreaming, messageType },
        transformers,
      ),
);

function applyMarkdownTransformers(
  markdown: string,
  context: MarkdownTransformContext,
  transformers: readonly MarkdownTransformer[],
): string {
  let transformedMarkdown = markdown;
  for (const transformer of transformers) {
    try {
      const transformed = transformer(transformedMarkdown, context);
      if (typeof transformed === "string") {
        transformedMarkdown = transformed;
      }
    } catch {}
  }
  return transformedMarkdown;
}

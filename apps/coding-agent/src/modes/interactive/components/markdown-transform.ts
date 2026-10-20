import { dual } from "effect/Function";

import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";

const createMarkdownTransform: {
  (
    isStreaming: boolean,
    transformers: readonly extensionsTypesTypes.MarkdownTransformer[],
  ): (
    messageType: extensionsTypesTypes.MarkdownTransformContext["messageType"],
  ) => (markdown: string, availableWidth: number) => string;
  (
    messageType: extensionsTypesTypes.MarkdownTransformContext["messageType"],
    isStreaming: boolean,
    transformers: readonly extensionsTypesTypes.MarkdownTransformer[],
  ): (markdown: string, availableWidth: number) => string;
} = dual(
  3,
  (
    messageType: extensionsTypesTypes.MarkdownTransformContext["messageType"],
    isStreaming: boolean,
    transformers: readonly extensionsTypesTypes.MarkdownTransformer[],
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
  context: extensionsTypesTypes.MarkdownTransformContext,
  transformers: readonly extensionsTypesTypes.MarkdownTransformer[],
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

const markdownTransform = {
  createMarkdownTransform,
};

export default markdownTransform;

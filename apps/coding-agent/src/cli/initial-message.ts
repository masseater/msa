import type { ImageContent } from "@msa/ai";

import type { Args } from "./args.ts";

export interface InitialMessageInput {
  parsed: Args;
  fileText?: string;
  fileImages?: ImageContent[];
  stdinContent?: string;
}

export interface InitialMessageResult {
  initialMessage?: string;
  initialImages?: ImageContent[];
}

/**
 * Combine stdin content, @file text, and the first CLI message into a single
 * initial prompt for non-interactive mode.
 */
export function buildInitialMessage({
  parsed,
  fileText,
  fileImages,
  stdinContent,
}: InitialMessageInput): InitialMessageResult {
  const parts: string[] = [];
  if (stdinContent !== undefined) {
    parts.push(stdinContent);
  }
  if (fileText) {
    parts.push(fileText);
  }

  const firstMessage = parsed.messages.shift();
  if (firstMessage !== undefined) {
    parts.push(firstMessage);
  }

  return {
    initialMessage: parts.length > 0 ? parts.join("") : undefined,
    initialImages: fileImages && fileImages.length > 0 ? fileImages : undefined,
  };
}

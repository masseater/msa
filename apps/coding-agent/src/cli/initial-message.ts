import type { ImageContent } from "@msa/ai";

import type { Args } from "./args.ts";

export interface InitialMessageInput {
  parsed: Args;
  fileText?: string | undefined;
  fileImages?: ImageContent[] | undefined;
  stdinContent?: string | undefined;
}

export interface InitialMessageResult {
  initialMessage?: string | undefined;
  initialImages?: ImageContent[] | undefined;
}

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
  if (fileText !== undefined && fileText !== "") {
    parts.push(fileText);
  }

  const firstMessage = parsed.messages.shift();
  if (firstMessage !== undefined) {
    parts.push(firstMessage);
  }

  return {
    initialMessage: parts.length > 0 ? parts.join("") : undefined,
    initialImages: fileImages !== undefined && fileImages.length > 0 ? fileImages : undefined,
  };
}

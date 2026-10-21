import type initialMessageTypes from "./initial-message.types.ts";

function buildInitialMessage({
  parsed,
  fileText,
  fileImages,
  stdinContent,
}: initialMessageTypes.InitialMessageInput): initialMessageTypes.InitialMessageResult {
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
    initialImages: fileImages !== undefined && fileImages.length > 0 ? fileImages : undefined,
    initialMessage: parts.length > 0 ? parts.join("") : undefined,
  };
}

const initialMessage = {
  buildInitialMessage,
};

export default initialMessage;

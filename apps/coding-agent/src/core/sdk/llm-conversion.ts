import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import messagesModule from "../messages.ts";
import type SettingsManager from "../settings-manager.ts";

const { convertToLlm } = messagesModule;

const IMAGE_PLACEHOLDER = "Image reading is disabled.";

const isPlaceholder = (block: { type: string; text?: string } | undefined): boolean =>
  block?.type === "text" && block.text === IMAGE_PLACEHOLDER;

const withoutImages = (message: compatTypes.Message): compatTypes.Message => {
  if (message.role !== "user" && message.role !== "toolResult") return message;
  const { content } = message;
  if (!Array.isArray(content) || !content.some((c) => c.type === "image")) return message;
  const filteredContent = content
    .map((c) => (c.type === "image" ? { text: IMAGE_PLACEHOLDER, type: "text" as const } : c))
    .filter((c, i, arr) => !(isPlaceholder(c) && i > 0 && isPlaceholder(arr[i - 1])));
  return { ...message, content: filteredContent };
};

const convertToLlmFor =
  (settingsManager: SettingsManager) =>
  (messages: agentTypes.AgentMessage[]): compatTypes.Message[] => {
    const converted = convertToLlm(messages);
    return settingsManager.display.getBlockImages() ? converted.map(withoutImages) : converted;
  };

const llmConversion = { convertToLlmFor };

export default llmConversion;

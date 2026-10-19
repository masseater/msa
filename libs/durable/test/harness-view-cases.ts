import { type AssistantMessage, fauxAssistantMessage, fauxText } from "@msa/ai";

export const MOUNTED = ["msa.agent", "msa.inbox", "msa.live", "msa.provider", "msa.usage"];

export function answer(text: string): AssistantMessage {
  return fauxAssistantMessage([fauxText(text)]);
}

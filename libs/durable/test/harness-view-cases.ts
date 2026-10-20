import { type AssistantMessage, fauxAssistantMessage, fauxText } from "@msa/ai";

const MOUNTED = ["msa.agent", "msa.inbox", "msa.live", "msa.provider", "msa.usage"];

function answer(text: string): AssistantMessage {
  return fauxAssistantMessage([fauxText(text)]);
}

const harnessViewCases = {
  MOUNTED,
  answer,
};

export default harnessViewCases;

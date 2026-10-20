import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";

const { fauxAssistantMessage, fauxText } = ai;

const MOUNTED = ["msa.agent", "msa.inbox", "msa.live", "msa.provider", "msa.usage"];

function answer(text: string): aiTypes.AssistantMessage {
  return fauxAssistantMessage([fauxText(text)]);
}

const harnessViewCases = {
  MOUNTED,
  answer,
};

export default harnessViewCases;

import type agentTypes from "@msa/agent-core/index.types";

import type bugReportInternalTypes from "./bug-report-internal.types.ts";
import bugReportPart2 from "./bug-report-part2.ts";
import compaction from "./compaction/compaction.ts";
import utils from "./compaction/utils.ts";
import messagesModule from "./messages.ts";

const { estimateTokens } = compaction;
const { serializeConversation } = utils;
const { convertToLlm } = messagesModule;
const { BUG_SUMMARY_INSTRUCTIONS } = bugReportPart2;

function selectMessages(
  messages: readonly agentTypes.AgentMessage[],
  tokenBudget: number,
): agentTypes.AgentMessage[] {
  const selected: agentTypes.AgentMessage[] = [];
  let tokens = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message === undefined) continue;
    const next = estimateTokens(message);
    if (selected.length > 0 && tokens + next > tokenBudget) break;
    selected.push(message);
    tokens += next;
  }
  return selected.reverse();
}

function generateBugReportSummaryPart1(
  options: bugReportInternalTypes.GenerateBugReportSummaryOptions,
  contextWindow: number,
) {
  const messages = selectMessages(options.messages, Math.floor(contextWindow * 0.6));
  const hint = options.hint?.trim();
  const prompt = [
    messages.length < options.messages.length
      ? `Note: only the last ${messages.length} of ${options.messages.length} messages are shown.`
      : undefined,
    `<conversation>\n${serializeConversation(convertToLlm(messages))}\n</conversation>`,
    hint !== undefined && hint !== "" ? `<user-report>\n${hint}\n</user-report>` : undefined,
    BUG_SUMMARY_INSTRUCTIONS,
  ]
    .filter((part) => part !== undefined)
    .join("\n\n");
  return prompt;
}

const bugReportPart3 = {
  generateBugReportSummaryPart1,
};

export default bugReportPart3;

import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type messagesTypes from "./messages.types.ts";
import platform from "./platform/index.ts";

const { toEpochMs } = platform;

const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

const COMPACTION_SUMMARY_SUFFIX = `
</summary>`;

const BRANCH_SUMMARY_PREFIX = `The following is a summary of a branch that this conversation came back from:

<summary>
`;

const BRANCH_SUMMARY_SUFFIX = `</summary>`;

declare global {
  interface MsaAgentCustomMessages {
    bashExecution: messagesTypes.BashExecutionMessage;
    custom: messagesTypes.CustomMessage;
    branchSummary: messagesTypes.BranchSummaryMessage;
    compactionSummary: messagesTypes.CompactionSummaryMessage;
  }
}

function bashExecutionToText(msg: messagesTypes.BashExecutionMessage): string {
  let text = `Ran \`${msg.command}\`\n`;
  if (msg.output === "") {
    text += "(no output)";
  } else {
    text += `\`\`\`\n${msg.output}\n\`\`\``;
  }
  if (msg.cancelled) {
    text += "\n\n(command cancelled)";
  } else if (msg.exitCode !== null && msg.exitCode !== undefined && msg.exitCode !== 0) {
    text += `\n\nCommand exited with code ${msg.exitCode}`;
  }
  if (msg.truncated && msg.fullOutputPath !== undefined && msg.fullOutputPath !== "") {
    text += `\n\n[Output truncated. Full output: ${msg.fullOutputPath}]`;
  }
  return text;
}

function createBranchSummaryMessage(
  summary: string,
  fromId: string,
  timestamp: string,
): messagesTypes.BranchSummaryMessage {
  return {
    fromId,
    role: "branchSummary",
    summary,
    timestamp: toEpochMs(timestamp),
  };
}

function createCompactionSummaryMessage(
  summary: string,
  tokensBefore: number,
  timestamp: string,
): messagesTypes.CompactionSummaryMessage {
  return {
    role: "compactionSummary",
    summary: summary,
    timestamp: toEpochMs(timestamp),
    tokensBefore,
  };
}

function createCustomMessage(
  customType: string,
  content: string | (aiTypes.TextContent | aiTypes.ImageContent)[],
  display: boolean,
  details: unknown | undefined,
  timestamp: string,
): messagesTypes.CustomMessage {
  return {
    content,
    customType,
    details,
    display,
    role: "custom",
    timestamp: toEpochMs(timestamp),
  };
}

function convertToLlm(messages: agentTypes.AgentMessage[]): aiTypes.Message[] {
  return messages
    .map((m): aiTypes.Message | undefined => {
      switch (m.role) {
        case "bashExecution":
          if (m.excludeFromContext === true) {
            return undefined;
          }
          return {
            content: [{ text: bashExecutionToText(m), type: "text" }],
            role: "user",
            timestamp: m.timestamp,
          };
        case "custom": {
          return customMessageToUser(m);
        }
        case "branchSummary":
          return {
            content: [
              {
                text: BRANCH_SUMMARY_PREFIX + m.summary + BRANCH_SUMMARY_SUFFIX,
                type: "text" as const,
              },
            ],
            role: "user",
            timestamp: m.timestamp,
          };
        case "compactionSummary":
          return {
            content: [
              {
                text: COMPACTION_SUMMARY_PREFIX + m.summary + COMPACTION_SUMMARY_SUFFIX,
                type: "text" as const,
              },
            ],
            role: "user",
            timestamp: m.timestamp,
          };
        case "system":
        case "user":
        case "assistant":
        case "toolResult":
          return m;
        default:
          m satisfies never;
          return undefined;
      }
    })
    .filter((m) => m !== undefined);
}

const messages = {
  BRANCH_SUMMARY_PREFIX,
  BRANCH_SUMMARY_SUFFIX,
  COMPACTION_SUMMARY_PREFIX,
  COMPACTION_SUMMARY_SUFFIX,
  bashExecutionToText,
  convertToLlm,
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
};

export default messages;

function customMessageToUser(m: messagesTypes.CustomMessage<unknown>): aiTypes.Message | undefined {
  const content =
    typeof m.content === "string" ? [{ text: m.content, type: "text" as const }] : m.content;
  return {
    content,
    role: "user",
    timestamp: m.timestamp,
  };
}

import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import { toEpochMs } from "./platform.ts";

export const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const COMPACTION_SUMMARY_SUFFIX = `
</summary>`;

export const BRANCH_SUMMARY_PREFIX = `The following is a summary of a branch that this conversation came back from:

<summary>
`;

export const BRANCH_SUMMARY_SUFFIX = `</summary>`;

export interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string | undefined;
  timestamp: number;
  excludeFromContext?: boolean | undefined;
}

export interface CustomMessage<T = unknown> {
  role: "custom";
  customType: string;
  content: string | (aiTypes.TextContent | aiTypes.ImageContent)[];
  display: boolean;
  details?: T | undefined;
  timestamp: number;
}

export interface BranchSummaryMessage {
  role: "branchSummary";
  summary: string;
  fromId: string | null;
  timestamp: number;
}

export interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;
  tokensBefore: number;
  timestamp: number;
}

declare global {
  interface MsaAgentCustomMessages {
    bashExecution: BashExecutionMessage;
    custom: CustomMessage;
    branchSummary: BranchSummaryMessage;
    compactionSummary: CompactionSummaryMessage;
  }
}

export function bashExecutionToText(msg: BashExecutionMessage): string {
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

export function createBranchSummaryMessage(
  summary: string,
  fromId: string,
  timestamp: string,
): BranchSummaryMessage {
  return {
    fromId,
    role: "branchSummary",
    summary,
    timestamp: toEpochMs(timestamp),
  };
}

export function createCompactionSummaryMessage(
  summary: string,
  tokensBefore: number,
  timestamp: string,
): CompactionSummaryMessage {
  return {
    role: "compactionSummary",
    summary: summary,
    timestamp: toEpochMs(timestamp),
    tokensBefore,
  };
}

export function createCustomMessage(
  customType: string,
  content: string | (aiTypes.TextContent | aiTypes.ImageContent)[],
  display: boolean,
  details: unknown | undefined,
  timestamp: string,
): CustomMessage {
  return {
    content,
    customType,
    details,
    display,
    role: "custom",
    timestamp: toEpochMs(timestamp),
  };
}

export function convertToLlm(messages: agentTypes.AgentMessage[]): aiTypes.Message[] {
  return messages
    .map((m): aiTypes.Message | undefined => {
      switch (m.role) {
        case "bashExecution":
          if (m.excludeFromContext === true) {
            return undefined;
          }
          return {
            content: [{ type: "text", text: bashExecutionToText(m) }],
            role: "user",
            timestamp: m.timestamp,
          };
        case "custom": {
          const content =
            typeof m.content === "string"
              ? [{ text: m.content, type: "text" as const }]
              : m.content;
          return {
            content,
            role: "user",
            timestamp: m.timestamp,
          };
        }
        case "branchSummary":
          return {
            content: [
              {
                type: "text" as const,
                text: BRANCH_SUMMARY_PREFIX + m.summary + BRANCH_SUMMARY_SUFFIX,
              },
            ],
            role: "user",
            timestamp: m.timestamp,
          };
        case "compactionSummary":
          return {
            content: [
              {
                type: "text" as const,
                text: COMPACTION_SUMMARY_PREFIX + m.summary + COMPACTION_SUMMARY_SUFFIX,
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

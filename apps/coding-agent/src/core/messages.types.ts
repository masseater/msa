import type aiTypes from "@msa/ai/index.types";

declare namespace messagesTypes {
  interface BashExecutionMessage {
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

  interface CustomMessage<T = unknown> {
    role: "custom";
    customType: string;
    content: string | (aiTypes.TextContent | aiTypes.ImageContent)[];
    display: boolean;
    details?: T | undefined;
    timestamp: number;
  }

  interface BranchSummaryMessage {
    role: "branchSummary";
    summary: string;
    fromId: string | null;
    timestamp: number;
  }

  interface CompactionSummaryMessage {
    role: "compactionSummary";
    summary: string;
    tokensBefore: number;
    timestamp: number;
  }
}

export type { messagesTypes as default };

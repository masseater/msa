import type {
  Query as QuerySource,
  SDKMessage as SDKMessageSource,
  SDKUserMessage as SDKUserMessageSource,
} from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam as ContentBlockParamSource } from "@anthropic-ai/sdk/resources/messages";
import type { McpServer as McpServerSource } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult as CallToolResultSource } from "@modelcontextprotocol/sdk/types.js";
import type compatTypes from "@msa/ai/compat.types";

import type nodeChildProcessTypes from "../platform/node/child-process.types.ts";
import type claudeAccountsTypes from "./claude-accounts.types.ts";
import type SessionClass from "./claude-code-session.ts";

declare namespace claudeCodeSessionTypes {
  type Effort = "low" | "medium" | "high" | "xhigh" | "max";

  interface SessionConfig {
    accounts: claudeAccountsTypes.Account[];
    model: string;
    effort: Effort | undefined;
    systemPrompt: string;
    tools: compatTypes.Tool[];
  }

  type Session = (typeof SessionClass)["prototype"];

  type Account = claudeAccountsTypes.Account;
  type CallToolResult = CallToolResultSource;
  type ChildProcess = nodeChildProcessTypes.ChildProcess;
  type ContentBlockParam = ContentBlockParamSource;
  type McpServer = McpServerSource;
  type Query = QuerySource;
  type SDKMessage = SDKMessageSource;
  type SDKUserMessage = SDKUserMessageSource;
  type Tool = compatTypes.Tool;
}

export type { claudeCodeSessionTypes as default };

import type { AgentMessage } from "@msa/agent-core";
import type { TextContent } from "@msa/ai";

import type { PlanRuntime } from "./state.ts";
import { isSafeCommand } from "./utils.ts";

const PLAN_MODE_PROMPT = `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- Built-in edit and write tools are disabled
- Other currently active tools remain available
- Bash is restricted to an allowlist of read-only commands

Ask clarifying questions using the questionnaire tool.
Use brave-search skill via bash for web research.

Create a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes - just describe what you would do.`;

export const executionPrompt = (
  todoList: string,
): string => `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`;

export const guardBash =
  (runtime: PlanRuntime) =>
  (toolName: string, command: string): { block: true; reason: string } | undefined => {
    if (!runtime.enabled || toolName !== "bash") return undefined;
    if (isSafeCommand(command)) return undefined;
    return {
      block: true,
      reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
    };
  };

export const filterPlanContext =
  (runtime: PlanRuntime) =>
  (messages: AgentMessage[]): { messages: AgentMessage[] } | undefined => {
    if (runtime.enabled) return undefined;

    return {
      messages: messages.filter((m) => {
        const msg = m as AgentMessage & { customType?: string };
        if (msg.customType === "plan-mode-context") return false;
        if (msg.role !== "user") return true;

        const content = msg.content;
        if (typeof content === "string") {
          return !content.includes("[PLAN MODE ACTIVE]");
        }
        if (Array.isArray(content)) {
          return !content.some(
            (c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
          );
        }
        return true;
      }),
    };
  };

export const planModeContextMessage = () => ({
  message: {
    customType: "plan-mode-context",
    content: PLAN_MODE_PROMPT,
    display: false,
  },
});

export const executionContextMessage = (todoList: string) => ({
  message: {
    customType: "plan-execution-context",
    content: executionPrompt(todoList),
    display: false,
  },
});

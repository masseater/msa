import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type stateTypes from "./state.types.ts";
import utils from "./utils.ts";

const { isSafeCommand } = utils;

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

const executionPrompt = (todoList: string): string => `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`;

const guardBash =
  (runtime: stateTypes.PlanRuntime) =>
  (toolName: string, command: string): { block: true; reason: string } | undefined => {
    if (!runtime.enabled || toolName !== "bash") return undefined;
    if (isSafeCommand(command)) return undefined;
    return {
      block: true,
      reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
    };
  };

const filterPlanContext =
  (runtime: stateTypes.PlanRuntime) =>
  (messages: agentTypes.AgentMessage[]): { messages: agentTypes.AgentMessage[] } | undefined => {
    if (runtime.enabled) return undefined;

    return {
      messages: messages.filter((m) => {
        const msg = m as agentTypes.AgentMessage & { customType?: string };
        if (msg.customType === "plan-mode-context") return false;
        if (msg.role !== "user") return true;

        const content = msg.content;
        if (typeof content === "string") {
          return !content.includes("[PLAN MODE ACTIVE]");
        }
        if (Array.isArray(content)) {
          return !content.some(
            (c) =>
              c.type === "text" && (c as aiTypes.TextContent).text?.includes("[PLAN MODE ACTIVE]"),
          );
        }
        return true;
      }),
    };
  };

const planModeContextMessage = () => ({
  message: {
    content: PLAN_MODE_PROMPT,
    customType: "plan-mode-context",
    display: false,
  },
});

const executionContextMessage = (todoList: string) => ({
  message: {
    content: executionPrompt(todoList),
    customType: "plan-execution-context",
    display: false,
  },
});

const context = {
  executionContextMessage,
  executionPrompt,
  filterPlanContext,
  guardBash,
  planModeContextMessage,
};

export default context;

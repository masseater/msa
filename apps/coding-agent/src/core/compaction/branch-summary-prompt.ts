import type agentTypes from "@msa/agent-core/index.types";

import messagesModule from "../messages.ts";
import type branchSummarizationTypes from "./branch-summarization.types.ts";
import summarizationCall from "./summarization-call.ts";
import utils from "./utils.ts";

const { serializeConversation } = utils;
const { buildSummarizationContext } = summarizationCall;
const { convertToLlm } = messagesModule;

const BRANCH_SUMMARY_PROMPT = `Create a structured summary of this conversation branch for context when returning later.

Use this EXACT format:

## Goal
[What was the user trying to accomplish in this branch?]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Work that was started but not finished]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [What should happen next to continue this work]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

function branchInstructions(
  options: branchSummarizationTypes.GenerateBranchSummaryOptions,
): string {
  const { customInstructions, replaceInstructions } = options;
  const hasCustom = customInstructions !== undefined && customInstructions !== "";
  if (replaceInstructions === true && hasCustom) return customInstructions;
  return hasCustom
    ? `${BRANCH_SUMMARY_PROMPT}\n\nAdditional focus: ${customInstructions}`
    : BRANCH_SUMMARY_PROMPT;
}

function branchContext(
  messages: agentTypes.AgentMessage[],
  options: branchSummarizationTypes.GenerateBranchSummaryOptions,
) {
  const conversationText = serializeConversation(convertToLlm(messages));
  const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${branchInstructions(options)}`;
  return buildSummarizationContext(promptText);
}

const branchSummaryPrompt = { branchContext };

export default branchSummaryPrompt;

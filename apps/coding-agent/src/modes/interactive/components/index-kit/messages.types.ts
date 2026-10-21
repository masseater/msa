import type assistantMessageTypes from "../assistant-message.types.ts";
import type bashExecutionTypes from "../bash-execution.types.ts";
import type branchSummaryMessageTypes from "../branch-summary-message.types.ts";
import type compactionSummaryMessageTypes from "../compaction-summary-message.types.ts";
import type customMessageTypes from "../custom-message.types.ts";
import type diffTypes from "../diff.types.ts";
import type skillInvocationMessageTypes from "../skill-invocation-message.types.ts";
import type toolExecutionTypes from "../tool-execution.types.ts";
import type userMessageTypes from "../user-message.types.ts";
import type visualTruncateTypes from "../visual-truncate.types.ts";

declare namespace componentsMessagesKitTypes {
  type AssistantMessageComponent = assistantMessageTypes.AssistantMessageComponent;
  type BashExecutionComponent = bashExecutionTypes.BashExecutionComponent;
  type BranchSummaryMessageComponent = branchSummaryMessageTypes.BranchSummaryMessageComponent;
  type CompactionSummaryMessageComponent =
    compactionSummaryMessageTypes.CompactionSummaryMessageComponent;
  type CustomMessageComponent = customMessageTypes.CustomMessageComponent;
  type RenderDiffOptions = diffTypes.RenderDiffOptions;
  type SkillInvocationMessageComponent =
    skillInvocationMessageTypes.SkillInvocationMessageComponent;
  type ToolExecutionComponent = toolExecutionTypes.ToolExecutionComponent;
  type ToolExecutionOptions = toolExecutionTypes.ToolExecutionOptions;
  type UserMessageComponent = userMessageTypes.UserMessageComponent;
  type VisualTruncateResult = visualTruncateTypes.VisualTruncateResult;
}

export type { componentsMessagesKitTypes as default };

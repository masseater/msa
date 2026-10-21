import AssistantMessageComponent from "../assistant-message.ts";
import BashExecutionComponent from "../bash-execution.ts";
import BranchSummaryMessageComponent from "../branch-summary-message.ts";
import CompactionSummaryMessageComponent from "../compaction-summary-message.ts";
import CustomMessageComponent from "../custom-message.ts";
import diff from "../diff.ts";
import SkillInvocationMessageComponent from "../skill-invocation-message.ts";
import ToolExecutionComponent from "../tool-execution.ts";
import UserMessageComponent from "../user-message.ts";
import visualTruncate from "../visual-truncate.ts";

const messagesKit: {
  readonly AssistantMessageComponent: typeof AssistantMessageComponent;
  readonly BashExecutionComponent: typeof BashExecutionComponent;
  readonly BranchSummaryMessageComponent: typeof BranchSummaryMessageComponent;
  readonly CompactionSummaryMessageComponent: typeof CompactionSummaryMessageComponent;
  readonly CustomMessageComponent: typeof CustomMessageComponent;
  readonly SkillInvocationMessageComponent: typeof SkillInvocationMessageComponent;
  readonly ToolExecutionComponent: typeof ToolExecutionComponent;
  readonly UserMessageComponent: typeof UserMessageComponent;
  readonly renderDiff: typeof diff.renderDiff;
  readonly truncateToVisualLines: typeof visualTruncate.truncateToVisualLines;
} = {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  SkillInvocationMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  renderDiff: diff.renderDiff,
  truncateToVisualLines: visualTruncate.truncateToVisualLines,
};

export default messagesKit;

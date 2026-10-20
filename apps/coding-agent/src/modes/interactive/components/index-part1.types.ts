import type arminTypes from "./armin.types.ts";
import type assistantMessageTypes from "./assistant-message.types.ts";
import type bashExecutionTypes from "./bash-execution.types.ts";
import type borderedLoaderTypes from "./bordered-loader.types.ts";
import type branchSummaryMessageTypes from "./branch-summary-message.types.ts";
import type compactionSummaryMessageTypes from "./compaction-summary-message.types.ts";
import type customEditorTypes from "./custom-editor.types.ts";
import type customMessageTypes from "./custom-message.types.ts";
import type diffTypes from "./diff.types.ts";

declare namespace componentsTypesPart1 {
  type ArminComponent = arminTypes.ArminComponent;
  type AssistantMessageComponent = assistantMessageTypes.AssistantMessageComponent;
  type BashExecutionComponent = bashExecutionTypes.BashExecutionComponent;
  type BorderedLoader = borderedLoaderTypes.BorderedLoader;
  type BranchSummaryMessageComponent = branchSummaryMessageTypes.BranchSummaryMessageComponent;
  type CompactionSummaryMessageComponent =
    compactionSummaryMessageTypes.CompactionSummaryMessageComponent;
  type CustomEditor = customEditorTypes.CustomEditor;
  type CustomEditorOptions = customEditorTypes.CustomEditorOptions;
  type CustomMessageComponent = customMessageTypes.CustomMessageComponent;
  type RenderDiffOptions = diffTypes.RenderDiffOptions;
}

export type { componentsTypesPart1 as default };

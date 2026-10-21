import type toolsModule from "../src/tools/index.ts";
import type specUsageExtensions from "./spec-usage-extensions.ts";

declare namespace specUsageSequencesTypes {
  type SpecTools = {
    readonly readTool: ReturnType<typeof toolsModule.createReadTool>;
    readonly editTool: ReturnType<typeof toolsModule.createEditTool>;
    readonly bashTool: SpecBashTool;
  };

  type SpecBashTool = Parameters<typeof specUsageExtensions.bashExtensions>[1];

  type SpecExtensions = ReturnType<typeof specUsageExtensions.promptExtensions> &
    ReturnType<typeof specUsageExtensions.bashExtensions> &
    ReturnType<typeof specUsageExtensions.planMode> & {
      readonly Subagent: ReturnType<typeof specUsageExtensions.subagentExtension>;
      readonly SubagentTools: ReturnType<typeof specUsageExtensions.subagentTools>;
      readonly Chat: ReturnType<typeof specUsageExtensions.chatExtension>;
    };
}

export type { specUsageSequencesTypes as default };

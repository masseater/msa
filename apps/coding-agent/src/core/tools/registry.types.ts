import type toolDefinitionWrapperTypes from "./tool-definition-wrapper.types.ts";
import type toolTypesTypes from "./tool-types.types.ts";

declare namespace registryTypes {
  type Tool = toolTypesTypes.Tool;

  type ToolDef = toolTypesTypes.ToolDef;

  type ToolName = toolTypesTypes.ToolName;

  type NamedToolFactory<R> = toolDefinitionWrapperTypes.NamedFactory<
    ToolName,
    toolTypesTypes.ToolsOptions,
    R
  >;

  type ToolsFactory<R> = toolDefinitionWrapperTypes.CwdFactory<toolTypesTypes.ToolsOptions, R>;
}

export type { registryTypes as default };

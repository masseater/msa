import type extensionsTypesTypes from "../extensions/types.types.ts";
import type bashOperationsTypes from "./bash-operations.types.ts";
import type bashOutputTypes from "./bash-output.types.ts";
import type bashTypesModule from "./bash-types.ts";
import type bashTypesTypes from "./bash-types.types.ts";

declare namespace bashTypes {
  type BashOperations = bashOperationsTypes.BashOperations;

  type ExecuteOptions = bashOperationsTypes.ExecuteOptions;

  type BashToolDetails = bashOutputTypes.BashToolDetails;

  type BashRenderState = bashTypesTypes.BashRenderState;

  type BashSpawnContext = bashTypesTypes.BashSpawnContext;

  type BashSpawnHook = bashTypesTypes.BashSpawnHook;

  type BashToolInput = bashTypesTypes.BashToolInput;

  type BashToolOptions = bashTypesTypes.BashToolOptions;

  type BashToolOutput = bashTypesTypes.BashToolOutput;

  type ShellToolConfig = bashTypesTypes.ShellToolConfig;

  type ShellToolContext = extensionsTypesTypes.ExtensionContext;

  type ShellToolDefinition = extensionsTypesTypes.ToolDefinition<
    typeof bashTypesModule.bashSchema,
    BashToolDetails | undefined,
    BashRenderState
  >;
}

export type { bashTypes as default };

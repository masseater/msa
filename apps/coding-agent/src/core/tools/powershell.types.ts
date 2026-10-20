import type bashTypes from "./bash.types.ts";

declare namespace powershellTypes {
  type PowerShellOperations = bashTypes.BashOperations;

  type PowerShellSpawnContext = bashTypes.BashSpawnContext;

  type PowerShellSpawnHook = bashTypes.BashSpawnHook;

  type PowerShellToolDetails = bashTypes.BashToolDetails;

  type PowerShellToolInput = bashTypes.BashToolInput;

  interface PowerShellToolOptions extends Pick<
    bashTypes.BashToolOptions,
    "operations" | "exposeSessionEnvironment" | "spawnHook"
  > {}
}

export type { powershellTypes as default };

import type registryState from "./registry-state.ts";
import type typesModule from "./types.types.ts";

declare namespace registryStateTypes {
  type RegistryState<Tool extends typesModule.ToolRegistration> = InstanceType<
    typeof registryState.RegistryState<Tool>
  >;
}

export type { registryStateTypes as default };

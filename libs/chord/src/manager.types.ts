import type managerTypesModule from "./manager-types.types.ts";

declare namespace managerTypes {
  type ControlMessage = managerTypesModule.ControlMessage;

  type Driver = managerTypesModule.Driver;

  type Exit = managerTypesModule.Exit;

  type ForkDriverOptions = managerTypesModule.ForkDriverOptions;

  type HostManager = managerTypesModule.HostManager;

  type HostManagerOptions = managerTypesModule.HostManagerOptions;

  type Instance = managerTypesModule.Instance;

  type Liveness = managerTypesModule.Liveness;
}

export type { managerTypes as default };

import type configInstallTypes from "./config-install.types.ts";
import type configPackageTypes from "./config-package.types.ts";

declare namespace configTypes {
  type InstallChange = configPackageTypes.InstallChange;

  type InstallMethod = configInstallTypes.InstallMethod;

  type SelfUpdateCommand = configInstallTypes.SelfUpdateCommand;

  type SelfUpdatePackageTarget = configInstallTypes.SelfUpdatePackageTarget;
}

export type { configTypes as default };

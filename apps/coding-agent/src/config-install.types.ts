import type configInstallCommandTypes from "./config-install-command.types.ts";

declare namespace configInstallTypes {
  type InstallMethod = configInstallCommandTypes.InstallMethod;

  type SelfUpdateCommand = configInstallCommandTypes.SelfUpdateCommand;

  type SelfUpdatePackageTarget = configInstallCommandTypes.SelfUpdatePackageTarget;
}

export type { configInstallTypes as default };
